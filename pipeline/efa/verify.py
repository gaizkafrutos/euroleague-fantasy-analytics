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
from efa.context import season_boxscores
from efa.gamelogs import build_coach_gamelog
from efa.ingest.official import load_reference
from efa.ingest.prices import latest_snapshot
from efa.metrics import player_performance

log = logging.getLogger(__name__)

#: Umbrales de aceptación. Generosos a propósito: `fpt` puede estar redondeado
#: o calculado sobre un subconjunto de jornadas distinto.
MIN_CORRELATION = 0.95
MAX_MEAN_ABS_ERROR = 2.5
#: El mercado redondea las medias a un decimal: más de 0,06 es un error de verdad.
ROUNDING = 0.06

#: Media por acción del mercado -> columna del game log. Si la media total
#: cuadra pero una acción no, el baremo ha cambiado justo en esa acción.
ACTIONS = {
    "pts": "points", "reb": "rebounds", "ast": "assists", "stl": "steals",
    "tov": "turnovers", "blk": "blocks_favour", "blka": "blocks_against",
    "fd": "fouls_drawn", "pf": "fouls_committed", "fg_missed": "missed_fg",
    "ft_missed": "missed_ft",
}


def _actions(market, crosswalk, gamelog) -> dict[str, float]:
    """Mayor diferencia, por acción, entre la media del mercado y la calculada."""
    played = gamelog[gamelog["played"]]
    means = played.groupby("person_code")[[c for c in ACTIONS.values() if c in played.columns]].mean()
    merged = market.merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id").merge(
        means, left_on="person_code", right_index=True
    )
    out = {}
    for column, source in ACTIONS.items():
        if column in merged.columns and source in merged.columns:
            diff = (merged[column] - merged[source].round(1)).abs()
            out[column] = round(float(diff.max()), 3) if len(diff) else 0.0
    return out


def _coaches(market, crosswalk) -> dict[str, Any] | None:
    """Los entrenadores puntúan por el marcador: su media tiene que cuadrar exacta."""
    reference = load_reference(SEASON_CODE)
    log = build_coach_gamelog(season_boxscores(SEASON_CODE), reference.get("games", []))
    if log.empty:
        return None
    means = log.groupby("person_code")["fantasy_points"].mean()
    merged = market.merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id")
    merged = merged[merged["person_code"].isin(means.index) & merged["fpt"].notna()]
    if merged.empty:
        return None
    diff = (merged["fpt"] - merged["person_code"].map(means)).abs()
    return {
        "coaches": int(len(merged)),
        "maxAbsError": round(float(diff.max()), 3),
        "overtimeGames": int(log["overtime"].sum()) if "overtime" in log.columns else 0,
    }


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

    actions = _actions(market, crosswalk, gamelog)
    coaches = _coaches(market, crosswalk)
    ok = (
        correlation >= MIN_CORRELATION
        and mae <= MAX_MEAN_ABS_ERROR
        and all(value <= ROUNDING for value in actions.values())
        and (coaches is None or coaches["maxAbsError"] <= ROUNDING)
    )
    return {
        "ok": ok,
        "actionsMaxAbsError": actions,
        "coaches": coaches,
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
