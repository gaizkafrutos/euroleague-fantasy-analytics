"""Qué jornada es la vigente y qué partidos quedan por jugar de verdad.

El calendario oficial marca cada partido como jugado o no, y con eso bastaba
mientras ninguno se aplazara. Un partido aplazado se queda "sin jugar" con su
fecha vieja: la jornada vigente era "la primera con algún partido sin jugar",
así que se habría quedado clavada en esa jornada, y ese partido habría salido
como el próximo de sus dos clubes hasta que se disputara.

Aquí un partido sin jugar cuya fecha quedó atrás (más de dos días antes del
último partido jugado) se trata como aplazado: no cuenta ni para la jornada
vigente ni como próximo rival.
"""
from __future__ import annotations

from typing import Any

import pandas as pd

#: Margen para dar por aplazado un partido sin jugar: su fecha es anterior en
#: más de esto a la del último partido jugado. Dentro de una jornada los
#: partidos van en dos o tres días seguidos, así que ninguno queda tan atrás.
STALE_AFTER = pd.Timedelta(hours=48)


def game_time(game: dict[str, Any]) -> pd.Timestamp | None:
    stamp = pd.to_datetime(game.get("utcDate"), utc=True, errors="coerce")
    return None if pd.isna(stamp) else stamp


def last_played_at(games: list[dict[str, Any]]) -> pd.Timestamp | None:
    """Fecha del último partido jugado."""
    times = [t for g in games if g.get("played") and (t := game_time(g)) is not None]
    return max(times) if times else None


def is_postponed(game: dict[str, Any], last_played: pd.Timestamp | None) -> bool:
    """Sin jugar y con la fecha ya superada por partidos posteriores."""
    if game.get("played") or last_played is None:
        return False
    stamp = game_time(game)
    return stamp is not None and stamp < last_played - STALE_AFTER


def pending_games(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Partidos por jugar, sin los aplazados, en orden de jornada y fecha."""
    last = last_played_at(games)
    pending = [g for g in games if not g.get("played") and not is_postponed(g, last)]
    return sorted(pending, key=lambda g: (int(g.get("round") or 0), str(g.get("utcDate") or "")))


def current_round(games: list[dict[str, Any]]) -> int:
    """Jornada vigente: la primera con algún partido por jugar, desde la última
    que ya tiene partidos jugados. Antes del inicio de temporada, la 1."""
    rounds = [int(g["round"]) for g in games if g.get("round") is not None]
    if not rounds:
        return 1
    reached = max((int(g["round"]) for g in games if g.get("played") and g.get("round") is not None), default=0)
    ahead = [int(g["round"]) for g in pending_games(games) if g.get("round") is not None and int(g["round"]) >= reached]
    return min(ahead) if ahead else max(reached, 1) if reached else max(rounds)


def round_progress(games: list[dict[str, Any]], round_number: int) -> dict[str, int]:
    """Partidos de una jornada y cuántos se han jugado (los aplazados no cuentan)."""
    last = last_played_at(games)
    in_round = [g for g in games if int(g.get("round") or 0) == round_number and not is_postponed(g, last)]
    return {"games": len(in_round), "played": sum(1 for g in in_round if g.get("played"))}
