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

import json
import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np

from efa.build import build_crosswalk, resolve_gamelog
from efa.config import PROCESSED_DIR, SEASON_CODE
from efa.context import season_boxscores
from efa.gamelogs import build_coach_gamelog
from efa.ingest.official import load_reference
from efa.ingest.prices import latest_snapshot
from efa.metrics import player_performance

log = logging.getLogger(__name__)

#: Umbrales de aceptación. Si el baremo cambia (una acción nueva, otro peso),
#: el error medio se dispara y casi nadie cuadra: los umbrales saltan a la vez.
#: Antes eran 0,95 de correlación y 2,5 de error, tan anchos que la
#: comprobación solo fallaba por el detalle de una acción suelta, y el aviso
#: acabó silenciado en el workflow.
MIN_CORRELATION = 0.99
MAX_MEAN_ABS_ERROR = 0.15
#: Parte mínima de jugadores cuya media cuadra al decimal con la del juego.
MIN_EXACT_SHARE = 0.85
#: Los entrenadores puntúan con seis cifras enteras: tienen que cuadrar todos,
#: con el margen de un redondeo de la media.
COACH_ROUNDING = 0.06
#: Donde se guarda el resultado para que la web lo enseñe (ver `build`).
REPORT_NAME = "formula_check.json"
#: Horas que se deja asentar un partido antes de comparar a sus dos clubes. El
#: juego puntúa en directo y la API oficial publica el acta al acabar: durante
#: unas horas las dos fuentes no hablan de los mismos partidos. La captura de
#: las 21:57 UTC del 12-11-2026 pilló cuatro partidos recién acabados y uno en
#: juego: uno de cada seis jugadores "no cuadraba" y la comprobación dio una
#: falsa alarma. Esos clubes se comparan en la captura siguiente.
SETTLE_HOURS = 12

#: Media por acción del mercado -> columna del game log. Si la media total
#: cuadra pero una acción no, el baremo ha cambiado justo en esa acción.
ACTIONS = {
    "pts": "points", "reb": "rebounds", "ast": "assists", "stl": "steals",
    "tov": "turnovers", "blk": "blocks_favour", "blka": "blocks_against",
    "fd": "fouls_drawn", "pf": "fouls_committed", "fg_missed": "missed_fg",
    "ft_missed": "missed_ft",
}


def _totals(market, crosswalk, gamelog):
    """Mercado unido a los totales del game log de cada jugador (y sus partidos)."""
    played = gamelog[gamelog["played"]]
    columns = [c for c in ACTIONS.values() if c in played.columns]
    grouped = played.groupby("person_code")
    totals = grouped[columns].sum()
    totals["n"] = grouped.size()
    return market.merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id").merge(
        totals, left_on="person_code", right_index=True
    )


def clubs_settling(games, captured_at, hours: float = SETTLE_HOURS) -> set[str]:
    """Clubes con un partido empezado en las últimas `hours` antes de la captura.

    Sale del CALENDARIO, no de los boxscores: el desfase va en los dos
    sentidos. El juego puntúa en directo un partido que la API oficial aún no
    da por jugado, y tarda en asentar uno que la API ya ha publicado.
    """
    import pandas as pd

    captured = pd.to_datetime(captured_at, utc=True, errors="coerce")
    if pd.isna(captured):
        return set()
    out: set[str] = set()
    for game in games or []:
        start = pd.to_datetime(game.get("utcDate"), utc=True, errors="coerce")
        if pd.isna(start) or not captured - pd.Timedelta(hours=hours) < start <= captured:
            continue
        for side in ("local", "road"):
            club = ((game.get(side) or {}).get("club") or {}).get("code")
            if club:
                out.add(str(club))
    return out


def _margin(games):
    """Lo que puede bailar un total reconstruido desde una media a un decimal."""
    return 0.05 * games + 0.02


def _actions(market, crosswalk, gamelog) -> dict[str, dict[str, float]]:
    """Por acción: la mayor diferencia entre la media del mercado y la calculada,
    y a cuántos jugadores les descuadra más de un redondeo."""
    merged = _totals(market, crosswalk, gamelog)
    out = {}
    for column, source in ACTIONS.items():
        if column in merged.columns and source in merged.columns and len(merged):
            gap = merged[column] * merged["n"] - merged[source]
            out[column] = {
                "maxAbsError": round(float((gap / merged["n"]).abs().max()), 3),
                "playersOff": int((gap.abs() > _margin(merged["n"])).sum()),
            }
    return out


def _foul_gap(market, crosswalk, gamelog) -> dict[str, int]:
    """Jugadores a los que el juego cuenta MENOS faltas que el acta oficial.

    No es el baremo: en algunos partidos (nueve hasta la J10 de la 2026-27) el
    juego no recogió las técnicas ni las antideportivas, y en el resto sí. A
    esos jugadores les sale un punto de más por falta. No se puede reproducir
    desde el acta, así que se cuenta y se enseña; la puntuación de aquí sigue
    al acta.
    """
    merged = _totals(market, crosswalk, gamelog)
    if "pf" not in merged.columns or "fouls_committed" not in merged.columns or merged.empty:
        return {"players": 0, "fouls": 0}
    gap = merged["fouls_committed"] - merged["pf"] * merged["n"]
    fewer = gap > _margin(merged["n"])
    return {"players": int(fewer.sum()), "fouls": int(gap[fewer].round().sum())}


def _coaches(market, crosswalk) -> dict[str, Any] | None:
    """Los entrenadores puntúan por el marcador: su media tiene que cuadrar exacta."""
    reference = load_reference(SEASON_CODE)
    log = build_coach_gamelog(season_boxscores(SEASON_CODE), reference.get("games", []))
    if log.empty:
        return None
    # El juego lleva la media del BANQUILLO del club, no la de la persona: con
    # un cambio de entrenador, el nuevo hereda los partidos del anterior
    # (Baskonia 2026-27: −7,7 con los once del club, no −8,3 con sus seis).
    means = log.groupby("club_code")["fantasy_points"].mean()
    merged = market.merge(crosswalk[["fantaking_id", "person_code", "club_code"]], on="fantaking_id")
    merged = merged[
        merged["person_code"].isin(set(log["person_code"]))
        & merged["club_code"].isin(means.index)
        & merged["fpt"].notna()
    ]
    if merged.empty:
        return None
    diff = (merged["fpt"] - merged["club_code"].map(means).round(1)).abs()
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
    # Quien acaba de jugar se compara en la próxima captura (ver SETTLE_HOURS).
    settling = clubs_settling(reference.get("games", []), market["captured_at"].max())
    if settling:
        crosswalk = crosswalk[~crosswalk["club_code"].isin(settling)]

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
    foul_gap = _foul_gap(market, crosswalk, gamelog)
    # "Al decimal": la media del juego va redondeada, así que se compara el
    # total con el margen de medio décimo por partido jugado.
    exact = comparable["error"].abs() * comparable["games_played"] <= _margin(comparable["games_played"])
    exact_share = float(exact.mean())
    ok = (
        correlation >= MIN_CORRELATION
        and mae <= MAX_MEAN_ABS_ERROR
        and exact_share >= MIN_EXACT_SHARE
        and (coaches is None or coaches["maxAbsError"] <= COACH_ROUNDING)
    )
    return {
        "ok": ok,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "capturedAt": market["captured_at"].max().isoformat(),
        "actions": actions,
        "coaches": coaches,
        "foulGap": foul_gap,
        # Clubes que acaban de jugar y se han dejado para la próxima captura.
        "settlingClubs": sorted(settling),
        "skipped": False,
        "players": int(len(comparable)),
        "exact": int(exact.sum()),
        "exactShare": round(exact_share, 3),
        "correlation": round(correlation, 4),
        "meanAbsoluteError": round(mae, 3),
        "bias": round(bias, 3),
        "thresholds": {
            "correlation": MIN_CORRELATION,
            "mae": MAX_MEAN_ABS_ERROR,
            "exactShare": MIN_EXACT_SHARE,
        },
        "worstMatches": worst,
        "interpretation": (
            "La fórmula reproduce la puntuación del juego."
            if ok
            else "Discrepancia relevante: revisa si Fantaking ha cambiado el baremo "
            "o si el cruce de identidades está mezclando jugadores."
        ),
    }


def save_report(report: dict[str, Any]) -> None:
    """Guarda el resumen para que `build` lo publique en `meta.json`.

    Solo lo que la web enseña: la lista de peores casos se queda en la consola.
    Una comprobación que no ha podido hacerse no pisa la anterior.
    """
    if report.get("skipped"):
        return
    keep = (
        "ok", "checkedAt", "capturedAt", "players", "exact", "exactShare",
        "meanAbsoluteError", "correlation", "coaches", "foulGap", "settlingClubs",
    )
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    (PROCESSED_DIR / REPORT_NAME).write_text(
        json.dumps({key: report.get(key) for key in keep}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )


def load_report() -> dict[str, Any] | None:
    """El último resumen guardado, o None."""
    try:
        return json.loads((PROCESSED_DIR / REPORT_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
