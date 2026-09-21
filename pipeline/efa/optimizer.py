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
    BENCH_MULTIPLIER,
    CAPTAIN_MULTIPLIER,
    MAX_PLAYERS_PER_CLUB,
    ROSTER_BUDGET,
    ROSTER_CENTERS,
    ROSTER_FORWARDS,
    ROSTER_GUARDS,
)

log = logging.getLogger(__name__)

POSITION_QUOTA = {"G": ROSTER_GUARDS, "F": ROSTER_FORWARDS, "C": ROSTER_CENTERS}

#: Cuántos de los diez puntúan al 100 %: el quinteto más el sexto hombre. Los
#: otros cuatro son banquillo y puntúan a la mitad. El capitán sale del
#: quinteto y dobla. Está en el reglamento de Classic Mode.
STARTERS = 5
FULL_SCORING_SLOTS = STARTERS + 1

#: Formaciones permitidas del quinteto (bases-aleros-pívots), según el
#: reglamento, página "Initial team": 2-2-1, 1-2-2, 2-1-2, 1-3-1 y 3-1-1.
#: Con cuatro bases, cuatro aleros y dos pívots en plantilla, esas cinco son
#: exactamente todas las que tienen al menos uno de cada puesto. La regla se
#: aplica así —mínimo uno de cada— y la lista queda como documentación.
ALLOWED_FORMATIONS = {(2, 2, 1), (1, 2, 2), (2, 1, 2), (1, 3, 1), (3, 1, 1)}
MIN_STARTERS_PER_POSITION = 1


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
    coach: Candidate | None = None

    @property
    def starters(self) -> list[Candidate]:
        """Los cinco del quinteto, con al menos uno de cada puesto."""
        return assign_roles(self.players)[0]

    @property
    def sixth(self) -> Candidate | None:
        """El sexto hombre, que también puntúa al 100 %."""
        return assign_roles(self.players)[1]

    @property
    def bench(self) -> list[Candidate]:
        """Los cuatro que puntúan a la mitad."""
        return assign_roles(self.players)[2]

    @property
    def scored_projection(self) -> float:
        """Lo que de verdad puntuaría esta plantilla.

        `total_projection` es la suma llana de los diez y se mantiene por
        compatibilidad, pero no es lo que se juega: cuatro de esos diez puntúan
        a la mitad y uno dobla.
        """
        starters, sixth, bench = assign_roles(self.players)
        full = sum(c.projection for c in starters) + (sixth.projection if sixth else 0.0)
        half = BENCH_MULTIPLIER * sum(c.projection for c in bench)
        captain_bonus = (
            (CAPTAIN_MULTIPLIER - 1) * self.captain.projection if self.captain else 0.0
        )
        coach = self.coach.projection if self.coach else 0.0
        return full + half + captain_bonus + coach

    def as_dict(self) -> dict[str, Any]:
        def brief(c: Candidate) -> dict[str, Any]:
            return {
                "key": c.key,
                "name": c.name,
                "position": c.position,
                "club": c.club_code,
                "price": round(c.price, 2),
                "projection": round(c.projection, 2),
            }

        sixth = self.sixth
        return {
            "method": self.method,
            "totalPrice": round(self.total_price, 2),
            "totalProjection": round(self.total_projection, 2),
            "scoredProjection": round(self.scored_projection, 2),
            "captain": self.captain.key if self.captain else None,
            "starters": [c.key for c in self.starters],
            "sixth": sixth.key if sixth else None,
            "bench": [c.key for c in self.bench],
            "coach": brief(self.coach) if self.coach else None,
            "players": [brief(c) for c in self.players],
        }


def _by_projection(players: Sequence[Candidate]) -> list[Candidate]:
    """De mayor a menor proyección. Quién va al quinteto sale de aquí."""
    return sorted(players, key=lambda c: -c.projection)


def assign_roles(
    players: Sequence[Candidate],
) -> tuple[list[Candidate], Candidate | None, list[Candidate]]:
    """El mejor reparto posible de una plantilla fija: (quinteto, sexto, banquillo).

    El quinteto y el sexto puntúan igual (100 %), así que lo que importa es
    QUÉ seis puntúan enteros, y la única regla que los condiciona es la de la
    formación: en el quinteto tiene que haber al menos un jugador de cada
    puesto. El óptimo es:

    1. Si entre los seis mejores falta algún puesto, el mejor de ese puesto
       entra obligado (cambiarlo por cualquier otro de su puesto solo resta).
    2. El resto de huecos, para los de mayor proyección.
    3. El sexto hombre es el peor de esos seis cuya salida no deje al quinteto
       sin un puesto; el capitán, el mejor, que siempre queda en el quinteto.

    Da lo mismo que una búsqueda exhaustiva (hay un test que lo comprueba) y
    es lo que usa también `squad.ts` en la web, para que las dos cuenten igual.
    """
    ranked = _by_projection(players)
    needed = [p for p in POSITION_QUOTA if any(c.position == p for c in ranked)]
    top = ranked[:FULL_SCORING_SLOTS]
    mandatory = [
        next(c for c in ranked if c.position == p)
        for p in needed
        if not any(c.position == p for c in top)
    ]
    rest = [c for c in ranked if c not in mandatory]
    full = _by_projection(mandatory + rest[: max(FULL_SCORING_SLOTS - len(mandatory), 0)])

    sixth: Candidate | None = None
    if len(full) > STARTERS:
        for candidate in reversed(full[1:]):
            remaining = [c for c in full if c is not candidate]
            if all(any(c.position == p for c in remaining) for p in needed):
                sixth = candidate
                break
    starters = [c for c in full if c is not sixth]
    bench = [c for c in ranked if c not in full]
    return starters, sixth, bench


def formation(starters: Sequence[Candidate]) -> tuple[int, int, int]:
    """(bases, aleros, pívots) de un quinteto."""
    return tuple(sum(1 for c in starters if c.position == p) for p in "GFC")  # type: ignore[return-value]


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
    coaches: Sequence[Candidate] = (),
) -> Lineup | None:
    """Mejor plantilla posible de 10 jugadores dentro del presupuesto.

    El entrenador SÍ compite por el presupuesto: es obligatorio y cuesta entre
    5 y 10 créditos. Si se pasa `coaches`, entra en el mismo problema y la
    plantilla resultante es alineable; si no se pasa, se optimizan solo los 10
    con todo el presupuesto, que es como se comportaba antes.

    `locked` fuerza la inclusión de jugadores; `excluded` los descarta.
    """
    pool = [c for c in candidates if c.key not in set(excluded) and c.position in POSITION_QUOTA]
    if not pool:
        return None
    coach_pool = [c for c in coaches if c.key not in set(excluded) and c.price > 0]

    try:
        return _optimize_ilp(pool, budget, set(locked), max_per_club, coach_pool)
    except ImportError:
        log.warning("PuLP no disponible: usando heurística voraz.")
        return _optimize_greedy(pool, budget, set(locked), max_per_club, coach_pool)
    except Exception as exc:  # pragma: no cover - el solver no debería fallar
        log.warning("El solver ILP falló (%s): usando heurística voraz.", exc)
        return _optimize_greedy(pool, budget, set(locked), max_per_club, coach_pool)


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
    pool: list[Candidate],
    budget: float,
    locked: set[str],
    max_per_club: int,
    coaches: Sequence[Candidate] = (),
) -> Lineup | None:
    """Programación entera con el baremo real del juego.

    Tres binarias por jugador en vez de una:
      x = está en la plantilla        (paga precio, puntúa al menos al 50 %)
      y = está en el grupo del 100 %  (quinteto + sexto hombre, seis en total)
      z = es el capitán               (uno, y sale del grupo del 100 %)

    Con z ≤ y ≤ x, el coeficiente `0,5·x + 0,5·y + z` vale 0,5 para el
    banquillo, 1 para el quinteto y el sexto, y 2 para el capitán. Es
    exactamente lo que dice el reglamento, y sigue siendo lineal.

    Y una cuarta, s = está en el quinteto (cinco, dentro del grupo del 100 %,
    con el capitán dentro), para imponer la formación: al menos un jugador de
    cada puesto en el quinteto. No cambia la puntuación —quinteto y sexto
    puntúan igual— pero sin ella el óptimo podía no ser alineable.
    """
    import pulp

    problem = pulp.LpProblem("fantasy_lineup", pulp.LpMaximize)
    variables = {c.key: pulp.LpVariable(f"x_{i}", cat="Binary") for i, c in enumerate(pool)}
    scoring = {c.key: pulp.LpVariable(f"y_{i}", cat="Binary") for i, c in enumerate(pool)}
    captain = {c.key: pulp.LpVariable(f"z_{i}", cat="Binary") for i, c in enumerate(pool)}
    starter = {c.key: pulp.LpVariable(f"s_{i}", cat="Binary") for i, c in enumerate(pool)}
    by_key = {c.key: c for c in pool}

    coach_vars = {c.key: pulp.LpVariable(f"e_{i}", cat="Binary") for i, c in enumerate(coaches)}
    by_coach = {c.key: c for c in coaches}

    problem += pulp.lpSum(
        by_key[k].projection * (0.5 * variables[k] + 0.5 * scoring[k] + captain[k])
        for k in variables
    ) + pulp.lpSum(by_coach[k].projection * v for k, v in coach_vars.items())

    problem += (
        pulp.lpSum(by_key[k].price * v for k, v in variables.items())
        + pulp.lpSum(by_coach[k].price * v for k, v in coach_vars.items())
    ) <= budget

    problem += pulp.lpSum(scoring.values()) == min(FULL_SCORING_SLOTS, len(pool))
    problem += pulp.lpSum(captain.values()) == 1
    problem += pulp.lpSum(starter.values()) == min(STARTERS, len(pool))
    for k in variables:
        problem += scoring[k] <= variables[k]
        problem += starter[k] <= scoring[k]
        problem += captain[k] <= starter[k]

    # Formación: al menos uno de cada puesto en el quinteto.
    for position in POSITION_QUOTA:
        if any(c.position == position for c in pool):
            problem += (
                pulp.lpSum(v for k, v in starter.items() if by_key[k].position == position)
                >= MIN_STARTERS_PER_POSITION
            )

    # El entrenador es obligatorio, pero solo si hay de dónde elegirlo.
    if coach_vars:
        problem += pulp.lpSum(coach_vars.values()) == 1

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
    picked_coach = next(
        (by_coach[k] for k, v in coach_vars.items() if v.value() and v.value() > 0.5), None
    )
    return _build_lineup(chosen, "ilp", coach=picked_coach)


def _optimize_greedy(
    pool: list[Candidate],
    budget: float,
    locked: set[str],
    max_per_club: int,
    coaches: Sequence[Candidate] = (),
) -> Lineup | None:
    """Voraz por ratio valor/precio + intercambios de mejora.

    El detalle que hace que funcione: antes de fichar a alguien se comprueba que
    con lo que queda se puedan seguir pagando las plazas pendientes. Sin esa
    reserva, la voracidad gasta el presupuesto arriba y se queda sin cubrir
    posiciones.
    """
    # El entrenador es obligatorio: su plaza se reserva antes de gastar.
    coach_floor = min((c.price for c in coaches), default=0.0)
    budget = budget - coach_floor

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

    spent = sum(c.price for c in chosen)
    affordable = [c for c in coaches if c.price <= budget + coach_floor - spent]
    picked_coach = max(affordable, key=lambda c: (c.projection, -c.price), default=None)
    return _build_lineup(chosen, "greedy", coach=picked_coach)


def _build_lineup(
    players: list[Candidate], method: str, *, coach: Candidate | None = None
) -> Lineup:
    return Lineup(
        players=sorted(players, key=lambda c: ("GFC".index(c.position), -c.projection)),
        total_price=sum(c.price for c in players) + (coach.price if coach else 0.0),
        total_projection=sum(c.projection for c in players),
        method=method,
        captain=_pick_captain(players),
        coach=coach,
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
