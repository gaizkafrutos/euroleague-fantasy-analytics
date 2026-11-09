"""Modelo de partido: margen esperado, probabilidad de victoria y puntos del entrenador.

El entrenador puntúa solo por el marcador (+10/+20/+25 al ganar por 1-10,
11-20 o más; −5/−10/−20 al perder; la prórroga cuenta como 1-10). Proyectarlo
con la media de lo que lleva hecho ignora a quién se enfrenta y dónde. Aquí:

  margen esperado = ventaja de campo + (fuerza del local − fuerza del visitante)

con la fuerza de cada club como su margen medio ajustado por campo, encogido
(k partidos) hacia la que corresponde al valor de mercado de su plantilla, y
el margen real repartido como una normal con la dispersión de la liga. Los
puntos esperados del entrenador y la probabilidad de ganar salen de esa normal.
"""
from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from efa.optimizer import normalize_position

#: Partidos de colchón hacia la fuerza de referencia (o hacia 0).
PRIOR_GAMES = 6.0
#: Jugadores más caros de cada club que cuentan para el valor de su plantilla:
#: con 6 acierta más que con 8 o 10 (la rotación corta es la que decide).
ROSTER_VALUE_TOP = 6
#: Ventaja de campo y dispersión por defecto, hasta tener 40 partidos.
DEFAULT_HOME = 3.45
DEFAULT_SD = 12.2

#: (desde, hasta, puntos) del margen del entrenador; la prórroga va en ±1-10.
_WIN = ((0.0, 10.5, 10.0), (10.5, 20.5, 20.0), (20.5, math.inf, 25.0))
_LOSS = ((-10.5, 0.0, -5.0), (-20.5, -10.5, -10.0), (-math.inf, -20.5, -20.0))


@dataclass(frozen=True)
class MatchModel:
    ratings: dict[str, float]
    home: float
    sd: float

    def margin(self, club: str, rival: str, at_home: bool) -> float:
        """Margen esperado de `club` contra `rival`."""
        edge = self.ratings.get(club, 0.0) - self.ratings.get(rival, 0.0)
        return edge + (self.home if at_home else -self.home)

    def win_prob(self, club: str, rival: str, at_home: bool) -> float:
        return _phi(self.margin(club, rival, at_home) / self.sd)

    def coach_points(self, club: str, rival: str, at_home: bool) -> float:
        return coach_mean(coach_outcomes(self.margin(club, rival, at_home), self.sd))


def coach_outcomes(margin: float, sd: float) -> list[tuple[float, float]]:
    """(puntos, probabilidad) del entrenador con un margen esperado y su dispersión."""
    return [
        (pts, _phi((hi - margin) / sd) - _phi((lo - margin) / sd)) for lo, hi, pts in _LOSS[::-1] + _WIN
    ]


def coach_mean(outcomes: list[tuple[float, float]]) -> float:
    return sum(pts * prob for pts, prob in outcomes)


def coach_sd(outcomes: list[tuple[float, float]]) -> float:
    mean = coach_mean(outcomes)
    return math.sqrt(sum(prob * (pts - mean) ** 2 for pts, prob in outcomes))


def coach_quantile(outcomes: list[tuple[float, float]], q: float) -> float:
    """Cuantil de una variable discreta: el primer resultado cuya acumulada llega a q."""
    total = 0.0
    for pts, prob in sorted(outcomes):
        total += prob
        if total >= q - 1e-12:
            return pts
    return max(pts for pts, _ in outcomes)


def coach_prob_above(outcomes: list[tuple[float, float]], threshold: float) -> float:
    return sum(prob for pts, prob in outcomes if pts > threshold)


def _phi(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _results(games: list[dict[str, Any]]) -> list[tuple[str, str, float]]:
    out = []
    for game in games:
        if not game.get("played"):
            continue
        local = ((game.get("local") or {}).get("club") or {}).get("code")
        road = ((game.get("road") or {}).get("club") or {}).get("code")
        if not local or not road:
            continue
        margin = float((game.get("local") or {}).get("score") or 0) - float((game.get("road") or {}).get("score") or 0)
        out.append((str(local), str(road), margin))
    return out


def _raw_ratings(results: list[tuple[str, str, float]], home: float) -> dict[str, tuple[float, int]]:
    acc: dict[str, list[float]] = {}
    for local, road, margin in results:
        adjusted = margin - home
        acc.setdefault(local, []).append(adjusted)
        acc.setdefault(road, []).append(-adjusted)
    return {club: (sum(values), len(values)) for club, values in acc.items()}


def roster_values(market: Any, top: int = ROSTER_VALUE_TOP) -> dict[str, float]:
    """Club -> cotización media de sus `top` jugadores más caros (sin entrenador).

    `market` necesita `club_code`, `position` y `quotation`.
    """
    if market is None or len(market) == 0:
        return {}
    players = market[market["position"].map(normalize_position).isin(["G", "F", "C"])]
    players = players.dropna(subset=["club_code", "quotation"])
    return {
        str(club): float(group["quotation"].astype(float).nlargest(top).mean())
        for club, group in players.groupby("club_code")
    }


def _value_ratings(raw: dict[str, tuple[float, int]], values: dict[str, float]) -> dict[str, float]:
    """Fuerza que corresponde al valor de cada plantilla: recta ajustada con los
    márgenes de esta temporada, centrada en la media."""
    clubs = [club for club in raw if club in values and raw[club][1]]
    if len(clubs) < 10:
        return {}
    mean = sum(values[c] for c in clubs) / len(clubs)
    spread = sum((values[c] - mean) ** 2 for c in clubs)
    if spread <= 0:
        return {}
    slope = sum((values[c] - mean) * raw[c][0] / raw[c][1] for c in clubs) / spread
    return {club: slope * (value - mean) for club, value in values.items()}


def fit(
    games: list[dict[str, Any]],
    prior_games: list[dict[str, Any]] | None = None,
    *,
    club_values: dict[str, float] | None = None,
) -> MatchModel:
    """Fuerza de cada club con los partidos jugados, encogida hacia una referencia.

    La referencia es el año pasado si se pasa `prior_games` y, si no, la que
    corresponde al valor de mercado de la plantilla (`club_values`). J7–J10 de
    la 2026-27, 40 partidos: el margen se falla por 9,84 con el año pasado, 10,29
    con el valor de plantilla y 10,45 encogiendo solo hacia 0.
    """
    now = _results(games)
    before = _results(prior_games or [])
    pool = now + before
    if len(pool) >= 40:
        margins = [m for _, _, m in pool]
        home = sum(margins) / len(margins)
        sd = math.sqrt(sum((m - home) ** 2 for m in margins) / (len(margins) - 1))
    else:
        home, sd = DEFAULT_HOME, DEFAULT_SD

    prior_raw = _raw_ratings(before, home)
    prior_rating = {club: total / count for club, (total, count) in prior_raw.items() if count}
    now_raw = _raw_ratings(now, home)
    if not prior_rating and club_values:
        prior_rating = _value_ratings(now_raw, club_values)
    ratings: dict[str, float] = {}
    for club in set(prior_rating) | set(now_raw):
        total, count = now_raw.get(club, (0.0, 0))
        base = prior_rating.get(club, 0.0)
        ratings[club] = (total + PRIOR_GAMES * base) / (count + PRIOR_GAMES)
    return MatchModel(ratings=ratings, home=home, sd=sd)


def coach_points_actual(margin: float, overtime: bool) -> float:
    """Puntos reales del entrenador para un margen (la prórroga cuenta como 1-10)."""
    if overtime:
        return 10.0 if margin > 0 else -5.0
    size = abs(margin)
    if margin > 0:
        return 10.0 if size <= 10 else 20.0 if size <= 20 else 25.0
    return -5.0 if size <= 10 else -10.0 if size <= 20 else -20.0


def backtest(
    games: list[dict[str, Any]],
    prior_games: list[dict[str, Any]] | None = None,
    *,
    values_for_round: Callable[[int], dict[str, float]] | None = None,
) -> dict[str, Any]:
    """Cada jornada con las anteriores: modelo de partido frente a la media del entrenador."""
    played = sorted((g for g in games if g.get("played")), key=lambda g: g.get("utcDate") or "")
    rounds = sorted({int(g["round"]) for g in played if g.get("round")})
    model_err: list[float] = []
    mean_err: list[float] = []
    for r in rounds:
        before = [g for g in played if int(g.get("round") or 0) < r]
        if len(before) < 20 and not prior_games:
            continue
        model = fit(before, prior_games, club_values=values_for_round(r) if values_for_round else None)
        history: dict[str, list[float]] = {}
        for g in before:
            ot = bool(((g.get("local") or {}).get("partials") or {}).get("extraPeriods"))
            m = float(g["local"]["score"]) - float(g["road"]["score"])
            history.setdefault(g["local"]["club"]["code"], []).append(coach_points_actual(m, ot))
            history.setdefault(g["road"]["club"]["code"], []).append(coach_points_actual(-m, ot))
        for g in (x for x in played if int(x.get("round") or 0) == r):
            ot = bool(((g.get("local") or {}).get("partials") or {}).get("extraPeriods"))
            m = float(g["local"]["score"]) - float(g["road"]["score"])
            for club, rival, home, sign in ((g["local"]["club"]["code"], g["road"]["club"]["code"], True, 1),
                                            (g["road"]["club"]["code"], g["local"]["club"]["code"], False, -1)):
                y = coach_points_actual(sign * m, ot)
                model_err.append(abs(model.coach_points(club, rival, home) - y))
                past = history.get(club)
                if past:
                    mean_err.append(abs(sum(past) / len(past) - y))
    if not model_err:
        return {"n": 0}
    return {
        "n": len(model_err),
        "model": round(sum(model_err) / len(model_err), 3),
        "mean": round(sum(mean_err) / len(mean_err), 3) if mean_err else None,
    }
