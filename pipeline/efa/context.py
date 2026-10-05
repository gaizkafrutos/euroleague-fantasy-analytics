"""Piezas compartidas del build: una sola versión de cada una.

Antes había dos `_season_label`, tres mapas de posiciones con reglas casi
iguales, y el game log de la temporada anterior se reconstruía cuatro veces en
cada build (descomprimir 400 boxscores y puntuarlos otra vez). Aquí se calculan
una vez por proceso.
"""
from __future__ import annotations

from collections.abc import Iterable
from functools import lru_cache
from typing import Any

import pandas as pd

from efa.gamelogs import build_gamelog
from efa.ingest.official import load_boxscores, load_reference
from efa.optimizer import normalize_position


def season_label(code: str | None) -> str:
    """E2026 -> 2026-27."""
    if not code or not code[1:].isdigit():
        return str(code or "—")
    year = int(code[1:])
    return f"{year}-{str(year + 1)[-2:]}"


@lru_cache(maxsize=4)
def _boxscores(code: str) -> dict[int, dict[str, Any]]:
    return load_boxscores(code)


def season_boxscores(code: str) -> dict[int, dict[str, Any]]:
    """Boxscores de una temporada, leídos una vez por proceso. No mutar."""
    return _boxscores(code)


@lru_cache(maxsize=4)
def _gamelog(code: str) -> pd.DataFrame:
    boxscores = _boxscores(code)
    if not boxscores:
        return pd.DataFrame()
    return build_gamelog(boxscores, load_reference(code).get("games", []))


def season_gamelog(code: str) -> pd.DataFrame:
    """Game log de una temporada (una fila por jugador y partido). Es una copia:
    se puede modificar sin tocar la caché."""
    return _gamelog(code).copy()


def clear_cache() -> None:
    """Para tests y para builds largos que reingieran datos."""
    _boxscores.cache_clear()
    _gamelog.cache_clear()


def player_positions(
    references: Iterable[dict[str, Any]],
    market: Iterable[tuple[Any, Any]] = (),
) -> dict[str, str]:
    """person_code -> G/F/C.

    La del censo oficial (la primera referencia que lo nombre gana) y, encima,
    la del juego para quien está en el mercado: es la que cuenta para el cupo
    de 4 bases, 4 aleros y 2 pívots. `market` son pares (person_code, posición).
    """
    out: dict[str, str] = {}
    for reference in references:
        for entry in reference.get("players", []):
            code = str((entry.get("person") or {}).get("code") or "")
            pos = normalize_position(entry.get("positionName"))
            if code and pos:
                out.setdefault(code, pos)
    for code, raw in market:
        pos = normalize_position(raw)
        if code is not None and not (isinstance(code, float) and pd.isna(code)) and pos:
            out[str(code)] = pos
    return out
