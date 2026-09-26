"""Modelo de partido: margen esperado, probabilidad de victoria y puntos del entrenador.

El entrenador puntúa solo por el marcador (+10/+20/+25 al ganar por 1-10,
11-20 o más; −5/−10/−20 al perder; la prórroga cuenta como 1-10). Proyectarlo
con la media de lo que lleva hecho ignora a quién se enfrenta y dónde. Aquí:

  margen esperado = ventaja de campo + (fuerza del local − fuerza del visitante)

con la fuerza de cada club como su margen medio ajustado por campo, encogido
hacia el de la temporada anterior (k partidos), y el margen real repartido
como una normal con la dispersión de la liga. Los puntos esperados del
entrenador y la probabilidad de ganar salen de esa normal.

Contrastado en la 2025-26 (724 partidos de entrenador, prediciendo cada
jornada con las anteriores): error medio 9,69 frente a 10,68 de la media del
entrenador.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

#: Partidos de colchón hacia la fuerza del año pasado (o hacia 0).
PRIOR_GAMES = 6.0
#: Ventaja de campo y dispersión por defecto (2025-26: 3,45 y 12,2 puntos).
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
        mu = self.margin(club, rival, at_home)
        return sum(
            (_phi((hi - mu) / self.sd) - _phi((lo - mu) / self.sd)) * pts for lo, hi, pts in _WIN + _LOSS
        )


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


def fit(games: list[dict[str, Any]], prior_games: list[dict[str, Any]] | None = None) -> MatchModel:
    """Fuerza de cada club con los partidos jugados, encogida hacia el año pasado."""
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


def backtest(games: list[dict[str, Any]], prior_games: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Cada jornada con las anteriores: modelo de partido frente a la media del entrenador."""
    played = sorted((g for g in games if g.get("played")), key=lambda g: g.get("utcDate") or "")
    rounds = sorted({int(g["round"]) for g in played if g.get("round")})
    model_err: list[float] = []
    mean_err: list[float] = []
    for r in rounds:
        before = [g for g in played if int(g.get("round") or 0) < r]
        if len(before) < 20 and not prior_games:
            continue
        model = fit(before, prior_games)
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
