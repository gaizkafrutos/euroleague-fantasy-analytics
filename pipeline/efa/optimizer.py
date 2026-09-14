"""Optimizador de plantilla.

Las reglas del Fantasy Challenge son un problema de mochila con restricciones:

    maximizar  sum(proyección_i * x_i)
    sujeto a   sum(precio_i * x_i) <= presupuesto
               4 bases, 4 aleros, 2 pívots, 1 entrenador
               <= 6 jugadores del mismo club

Se resuelve por programación entera (PuLP + CBC), que da el óptimo demostrable.
Si PuLP no está disponible cae a una heurística voraz con búsqueda local, que
en la práctica queda a un 1-2% del óptimo.
"""
from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from efa.config import (
    MAX_PLAYERS_PER_CLUB,
    ROSTER_BUDGET,
    ROSTER_CENTERS,
    ROSTER_FORWARDS,
    ROSTER_GUARDS,
)

log = logging.getLogger(__name__)

POSITION_QUOTA = {"G": ROSTER_GUARDS, "F": ROSTER_FORWARDS, "C": ROSTER_CENTERS}


def normalize_position(raw: Any) -> str | None:
    """Reduce cualquier etiqueta de posición a G / F / C."""
    if raw is None:
        return None
    text = str(raw).strip().upper()
    if not text:
        return None
    if text.startswith("G") or "GUARD" in text or text in {"PG", "SG", "1", "2"}:
        return "G"
    if text.startswith("F") or "FORWARD" in text or text in {"SF", "PF", "3", "4"}:
        return "F"
    if text.startswith("C") or "CENTER" in text or "CENTRE" in text or text in {"5"}:
        return "C"
    return None


@dataclass(frozen=True)
class Candidate:
    key: str
    name: str
    position: str          # G / F / C
    club_code: str
    price: float
    projection: float

    @property
    def value(self) -> float:
        return self.projection / self.price if self.price > 0 else 0.0


@dataclass
class Lineup:
    players: list[Candidate]
    total_price: float
    total_projection: float
    method: str
    captain: Candidate | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "totalPrice": round(self.total_price, 2),
            "totalProjection": round(self.total_projection, 2),
            "captain": self.captain.key if self.captain else None,
            "players": [
                {
                    "key": c.key,
                    "name": c.name,
                    "position": c.position,
                    "club": c.club_code,
                    "price": round(c.price, 2),
                    "projection": round(c.projection, 2),
                }
                for c in self.players
            ],
        }


def _pick_captain(players: Sequence[Candidate]) -> Candidate | None:
    """El capitán duplica su puntuación, así que es simplemente el mayor proyectado."""
    return max(players, key=lambda c: c.projection) if players else None


def optimize(
    candidates: Sequence[Candidate],
    *,
    budget: float = ROSTER_BUDGET,
    locked: Sequence[str] = (),
    excluded: Sequence[str] = (),
    max_per_club: int = MAX_PLAYERS_PER_CLUB,
) -> Lineup | None:
    """Mejor plantilla posible de 10 jugadores dentro del presupuesto.

    El entrenador se elige aparte (su puntuación no depende del precio del
    jugador ni compite por las mismas plazas), así que aquí solo van los 10.
    `locked` fuerza la inclusión de jugadores; `excluded` los descarta.
    """
    pool = [c for c in candidates if c.key not in set(excluded) and c.position in POSITION_QUOTA]
    if not pool:
        return None

    try:
        return _optimize_ilp(pool, budget, set(locked), max_per_club)
    except ImportError:
        log.warning("PuLP no disponible: usando heurística voraz.")
        return _optimize_greedy(pool, budget, set(locked), max_per_club)
    except Exception as exc:  # pragma: no cover - el solver no debería fallar
        log.warning("El solver ILP falló (%s): usando heurística voraz.", exc)
        return _optimize_greedy(pool, budget, set(locked), max_per_club)


def _silent_solver(pulp_module: Any):
    """Solver CBC sin ruido, tolerante a los renombres entre versiones de PuLP."""
    for attribute in ("PULP_CBC_CMD", "COIN_CMD"):
        factory = getattr(pulp_module, attribute, None)
        if factory is None:
            continue
        try:
            solver = factory(msg=False)
            if solver.available():
                return solver
        except Exception:  # noqa: BLE001 - se prueba el siguiente
            continue
    return None


def _optimize_ilp(
    pool: list[Candidate], budget: float, locked: set[str], max_per_club: int
) -> Lineup | None:
    import pulp

    problem = pulp.LpProblem("fantasy_lineup", pulp.LpMaximize)
    variables = {c.key: pulp.LpVariable(f"x_{i}", cat="Binary") for i, c in enumerate(pool)}
    by_key = {c.key: c for c in pool}

    problem += pulp.lpSum(by_key[k].projection * v for k, v in variables.items())
    problem += pulp.lpSum(by_key[k].price * v for k, v in variables.items()) <= budget

    for position, quota in POSITION_QUOTA.items():
        problem += (
            pulp.lpSum(v for k, v in variables.items() if by_key[k].position == position) == quota
        )

    clubs = {c.club_code for c in pool}
    for club in clubs:
        problem += (
            pulp.lpSum(v for k, v in variables.items() if by_key[k].club_code == club)
            <= max_per_club
        )

    for key in locked:
        if key in variables:
            problem += variables[key] == 1

    problem.solve(_silent_solver(pulp))
    if pulp.LpStatus[problem.status] != "Optimal":
        return None

    chosen = [by_key[k] for k, v in variables.items() if v.value() and v.value() > 0.5]
    return _build_lineup(chosen, "ilp")


def _optimize_greedy(
    pool: list[Candidate], budget: float, locked: set[str], max_per_club: int
) -> Lineup | None:
    """Voraz por ratio valor/precio + intercambios de mejora.

    El detalle que hace que funcione: antes de fichar a alguien se comprueba que
    con lo que queda se puedan seguir pagando las plazas pendientes. Sin esa
    reserva, la voracidad gasta el presupuesto arriba y se queda sin cubrir
    posiciones.
    """
    by_key = {c.key: c for c in pool}
    chosen: list[Candidate] = [by_key[k] for k in locked if k in by_key]
    remaining = [c for c in pool if c.key not in locked]
    remaining.sort(key=lambda c: c.value, reverse=True)

    # Precios ordenados por posición, para calcular el coste mínimo restante.
    cheapest: dict[str, list[float]] = {}
    for position in POSITION_QUOTA:
        cheapest[position] = sorted(c.price for c in pool if c.position == position)

    def counts(players: list[Candidate]) -> tuple[dict[str, int], dict[str, int], float]:
        positions: dict[str, int] = {}
        clubs: dict[str, int] = {}
        spend = 0.0
        for player in players:
            positions[player.position] = positions.get(player.position, 0) + 1
            clubs[player.club_code] = clubs.get(player.club_code, 0) + 1
            spend += player.price
        return positions, clubs, spend

    def min_cost_to_complete(positions: dict[str, int], skip_position: str | None = None) -> float:
        """Coste mínimo de cubrir las plazas que faltan tras el fichaje en curso."""
        total = 0.0
        for position, quota in POSITION_QUOTA.items():
            missing = quota - positions.get(position, 0)
            if position == skip_position:
                missing -= 1
            if missing <= 0:
                continue
            prices = cheapest[position]
            if len(prices) < missing:
                return float("inf")
            total += sum(prices[:missing])
        return total

    for candidate in remaining:
        positions, clubs, spend = counts(chosen)
        if len(chosen) >= sum(POSITION_QUOTA.values()):
            break
        if positions.get(candidate.position, 0) >= POSITION_QUOTA[candidate.position]:
            continue
        if clubs.get(candidate.club_code, 0) >= max_per_club:
            continue
        reserve = min_cost_to_complete(positions, skip_position=candidate.position)
        if spend + candidate.price + reserve > budget:
            continue
        chosen.append(candidate)

    positions, _, _ = counts(chosen)
    if any(positions.get(p, 0) < q for p, q in POSITION_QUOTA.items()):
        return None

    # Búsqueda local: intenta sustituir a cada elegido por alguien mejor que quepa.
    improved = True
    while improved:
        improved = False
        for i, current in enumerate(list(chosen)):
            if current.key in locked:
                continue
            _, clubs, spend = counts(chosen)
            headroom = budget - spend + current.price
            for candidate in pool:
                if candidate.key in {c.key for c in chosen}:
                    continue
                if candidate.position != current.position:
                    continue
                if candidate.price > headroom:
                    continue
                club_count = clubs.get(candidate.club_code, 0) - (
                    1 if candidate.club_code == current.club_code else 0
                )
                if club_count >= max_per_club:
                    continue
                if candidate.projection > current.projection:
                    chosen[i] = candidate
                    improved = True
                    break

    return _build_lineup(chosen, "greedy")


def _build_lineup(players: list[Candidate], method: str) -> Lineup:
    return Lineup(
        players=sorted(players, key=lambda c: ("GFC".index(c.position), -c.projection)),
        total_price=sum(c.price for c in players),
        total_projection=sum(c.projection for c in players),
        method=method,
        captain=_pick_captain(players),
    )


def suggest_swaps(
    current: Sequence[Candidate],
    market: Sequence[Candidate],
    *,
    budget_free: float,
    max_suggestions: int = 3,
    max_per_club: int = MAX_PLAYERS_PER_CLUB,
) -> list[dict[str, Any]]:
    """Para cada jugador del equipo, el mejor recambio asequible de su posición.

    `budget_free` son los créditos libres: al vender a un jugador se recupera su
    precio, así que el techo de gasto del recambio es ese precio más lo libre.
    """
    owned_keys = {c.key for c in current}
    club_counts: dict[str, int] = {}
    for player in current:
        club_counts[player.club_code] = club_counts.get(player.club_code, 0) + 1

    suggestions: list[dict[str, Any]] = []
    for player in current:
        ceiling = player.price + budget_free
        options = [
            c
            for c in market
            if c.key not in owned_keys
            and c.position == player.position
            and c.price <= ceiling
            and c.projection > player.projection
            and (club_counts.get(c.club_code, 0) - (1 if c.club_code == player.club_code else 0)) < max_per_club
        ]
        if not options:
            continue
        options.sort(key=lambda c: c.projection, reverse=True)
        best = options[0]
        suggestions.append(
            {
                "out": {
                    "key": player.key,
                    "name": player.name,
                    "price": round(player.price, 2),
                    "projection": round(player.projection, 2),
                },
                "in": {
                    "key": best.key,
                    "name": best.name,
                    "club": best.club_code,
                    "price": round(best.price, 2),
                    "projection": round(best.projection, 2),
                },
                "gain": round(best.projection - player.projection, 2),
                "costDelta": round(best.price - player.price, 2),
            }
        )

    suggestions.sort(key=lambda s: s["gain"], reverse=True)
    return suggestions[:max_suggestions]
