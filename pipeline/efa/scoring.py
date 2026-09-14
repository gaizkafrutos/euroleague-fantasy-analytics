"""Implementación de la fórmula de puntuación del EuroLeague Fantasy Challenge.

Fuente: fantaking.gitbook.io/euroleague-fantasy-challenge-rules
        (classic-mode/players-scoring y classic-mode/coach-scoring)

Jugador — suma de acciones estadísticas:

    +1  punto anotado
    +1  rebote (total)
    +1  asistencia
    +1  robo                       -1  pérdida
    +1  tapón puesto               -1  tapón recibido
    +1  falta recibida             -1  falta cometida
                                   -1  tiro de campo fallado
                                   -1  tiro libre fallado

    Bonus de victoria: +10% del score de la jornada si su equipo gana.

Entrenador — solo depende del margen del resultado (ver COACH_SCORING).

Por qué importa: el endpoint de mercado de Fantaking solo da *medias*. Con esta
fórmula podemos reconstruir la puntuación fantasy partido a partido desde los
boxscores oficiales, y de ahí sacan sentido la varianza, la forma reciente y la
tendencia de minutos — que son las señales que de verdad deciden un fichaje.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from efa.config import COACH_SCORING, WIN_BONUS_RATE


@dataclass(frozen=True)
class FantasyLine:
    """Desglose de la puntuación fantasy de un jugador en un partido."""

    base: float
    win_bonus: float
    total: float
    minutes: float
    played: bool

    def as_dict(self) -> dict[str, float | bool]:
        return {
            "base": round(self.base, 2),
            "win_bonus": round(self.win_bonus, 2),
            "total": round(self.total, 2),
            "minutes": round(self.minutes, 2),
            "played": self.played,
        }


def _f(stats: Mapping[str, Any], key: str) -> float:
    value = stats.get(key)
    return float(value) if value is not None else 0.0


def seconds_to_minutes(time_played: float) -> float:
    """La API oficial da `timePlayed` en segundos."""
    return round(time_played / 60.0, 2)


def player_fantasy_points(stats: Mapping[str, Any], *, team_won: bool) -> FantasyLine:
    """Puntuación fantasy de un jugador a partir de su línea de boxscore oficial.

    `stats` es el objeto `stats` de `players[]` en
    `/competitions/E/seasons/{season}/games/{gameCode}/stats`.
    """
    missed_fg = _f(stats, "fieldGoalsAttemptedTotal") - _f(stats, "fieldGoalsMadeTotal")
    missed_ft = _f(stats, "freeThrowsAttempted") - _f(stats, "freeThrowsMade")

    base = (
        _f(stats, "points")
        + _f(stats, "totalRebounds")
        + _f(stats, "assistances")
        + _f(stats, "steals")
        - _f(stats, "turnovers")
        + _f(stats, "blocksFavour")
        - _f(stats, "blocksAgainst")
        + _f(stats, "foulsReceived")
        - _f(stats, "foulsCommited")
        - max(missed_fg, 0.0)
        - max(missed_ft, 0.0)
    )

    minutes = seconds_to_minutes(_f(stats, "timePlayed"))
    played = minutes > 0

    # El bonus es un +10% del score de la ronda. Si el score es negativo el
    # "bonus" lo empeora; así es como está escrita la regla, y así se aplica.
    win_bonus = base * WIN_BONUS_RATE if (team_won and played) else 0.0

    return FantasyLine(
        base=base,
        win_bonus=win_bonus,
        total=base + win_bonus,
        minutes=minutes,
        played=played,
    )


def coach_fantasy_points(margin: int, *, overtime: bool = False) -> int:
    """Puntuación del entrenador según el margen (positivo = victoria)."""
    if margin == 0:
        return 0
    won = margin > 0
    absolute = abs(margin)

    if overtime:
        return COACH_SCORING["win_ot"] if won else COACH_SCORING["loss_ot"]
    if absolute <= 10:
        return COACH_SCORING["win_1_10"] if won else COACH_SCORING["loss_1_10"]
    if absolute <= 20:
        return COACH_SCORING["win_11_20"] if won else COACH_SCORING["loss_11_20"]
    return COACH_SCORING["win_20_plus"] if won else COACH_SCORING["loss_20_plus"]


def lineup_score(
    starters: list[float],
    bench: list[float],
    *,
    captain_index: int | None = 0,
    bench_multiplier: float = 0.5,
    captain_multiplier: float = 2.0,
) -> float:
    """Score de una alineación: titulares al 100%, banquillo al 50%, capitán x2."""
    total = 0.0
    for i, score in enumerate(starters):
        multiplier = captain_multiplier if i == captain_index else 1.0
        total += score * multiplier
    total += sum(score * bench_multiplier for score in bench)
    return round(total, 2)


def is_overtime(payload: Mapping[str, Any]) -> bool:
    """Detecta prórroga leyendo los parciales de un boxscore."""
    for side in ("local", "road"):
        partials = payload.get(side, {}).get("partials") or {}
        extra = partials.get("extraPeriods") or {}
        if extra:
            return True
    return False
