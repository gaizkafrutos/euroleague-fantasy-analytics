"""Verificación de la fórmula de puntuación contra los datos reales.

La fórmula está documentada por Fantaking, pero documentación y comportamiento
no siempre coinciden. Esta comprobación calcula la media de puntos fantasy de
cada jugador desde los boxscores oficiales y la contrasta con la columna `fpt`
que devuelve el propio mercado de Fantaking.

Si la correlación es alta y el error medio pequeño, la fórmula reproduce el
juego. Si no, algo ha cambiado — y es mejor enterarse por aquí que por un
fichaje mal decidido.
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np

from efa.build import build_crosswalk, resolve_gamelog
from efa.config import SEASON_CODE
from efa.ingest.official import load_reference
from efa.ingest.prices import latest_snapshot
from efa.metrics import player_performance

log = logging.getLogger(__name__)

#: Umbrales de aceptación. Generosos a propósito: `fpt` puede estar redondeado
#: o calculado sobre un subconjunto de jornadas distinto.
MIN_CORRELATION = 0.95
MAX_MEAN_ABS_ERROR = 2.5


def run_verification() -> dict[str, Any]:
    reference = load_reference(SEASON_CODE)
    market = latest_snapshot()

    if market.empty:
        return {
            "ok": False,
            "skipped": True,
            "reason": "No hay snapshot de precios con el que contrastar. Ejecuta `efa snapshot`.",
        }

    gamelog, meta = resolve_gamelog(reference)
    if gamelog.empty:
        return {
            "ok": False,
            "skipped": True,
            "reason": "No hay boxscores. Ejecuta `efa ingest-official`.",
        }
    if meta.get("isBaseline"):
        return {
            "ok": False,
            "skipped": True,
            "reason": (
                "Solo hay datos de la temporada anterior. La comparación con `fpt` "
                "no tiene sentido hasta que la temporada en curso tenga jornadas."
            ),
        }

    performance = player_performance(gamelog)
    crosswalk = build_crosswalk(market, reference)

    merged = (
        market.merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id", how="left")
        .merge(performance[["person_code", "fp_avg", "games_played"]], on="person_code", how="left")
    )
    comparable = merged[
        merged["fp_avg"].notna()
        & merged["fpt"].notna()
        & (merged["games_played"] >= 2)
    ].copy()

    if len(comparable) < 20:
        return {
            "ok": False,
            "skipped": True,
            "reason": f"Solo {len(comparable)} jugadores comparables; hacen falta al menos 20.",
        }

    comparable["error"] = comparable["fp_avg"] - comparable["fpt"]
    correlation = float(np.corrcoef(comparable["fp_avg"], comparable["fpt"])[0, 1])
    mae = float(comparable["error"].abs().mean())
    bias = float(comparable["error"].mean())

    worst = (
        comparable.reindex(comparable["error"].abs().sort_values(ascending=False).index)
        .head(10)[["fantaking_id", "name", "team", "fpt", "fp_avg", "error"]]
        .to_dict(orient="records")
    )

    ok = correlation >= MIN_CORRELATION and mae <= MAX_MEAN_ABS_ERROR
    return {
        "ok": ok,
        "skipped": False,
        "players": int(len(comparable)),
        "correlation": round(correlation, 4),
        "meanAbsoluteError": round(mae, 3),
        "bias": round(bias, 3),
        "thresholds": {"correlation": MIN_CORRELATION, "mae": MAX_MEAN_ABS_ERROR},
        "worstMatches": worst,
        "interpretation": (
            "La fórmula reproduce la puntuación del juego."
            if ok
            else "Discrepancia relevante: revisa si Fantaking ha cambiado el baremo "
            "o si el cruce de identidades está mezclando jugadores."
        ),
    }
