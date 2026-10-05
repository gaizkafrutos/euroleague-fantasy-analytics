"""Capa avanzada del build: engancha efa.advanced a los JSON de la web.

Se llama desde `build()` una vez montados los registros de jugador y de club.
Añade, sin tocar lo que ya había:

  players.json   `outlook`  umbral de revalorización, variación esperada,
                            probabilidad de subir, suelo y techo.
  details.json   `shots`    tiros por zona (dos temporadas) y los de esta.
                 `court`    minutos por cuarto, final apretado, uso, on/off.
                 `mix`      de qué acciones salen sus puntos fantasy.
                 `official` avanzadas oficiales con su percentil.
  teams.json     `allowed`  puntos fantasy que concede, por puesto.
                 `upcoming` las próximas cinco jornadas.
                 `quarters` parciales por cuarto.
                 `lineups`  quintetos más usados.
  meta.json      `priceModel`, `league` (medias de referencia).

Regla de temporadas, en todas las piezas: la temporada en curso manda en
cuanto tiene partidos suficientes; hasta entonces se completa con la anterior
y la web dice de dónde sale cada cifra.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any

import pandas as pd

from efa.advanced import (
    DEFAULT_PRICE_MODEL,
    ZONES,
    add_zones,
    allowed_by_position,
    analyse_season,
    blend_allowed,
    break_even,
    expected_change,
    fantasy_mix,
    fit_price_model,
    player_court_stats,
    prob_above,
    quarter_splits,
    team_lineups,
    zone_table,
)
from efa.config import PRIOR_SEASON_CODE, PRIOR_WEIGHT_GAMES, SEASON_CODE
from efa.context import player_positions, season_boxscores, season_gamelog, season_label
from efa.ingest.official import load_player_stats, load_reference
from efa.ingest.playbyplay import load_pbp, shots_frame
from efa.matchmodel import coach_outcomes, coach_prob_above, coach_quantile, coach_sd
from efa.optimizer import normalize_position

log = logging.getLogger(__name__)


def _load_z_quantiles() -> dict[str, float]:
    """Residuos del backtest en unidades de su RMSE (ver `efa backtest`)."""
    from efa.config import PROCESSED_DIR

    path = PROCESSED_DIR / "projection_backtest.json"
    default = {"p10": -1.14, "p25": -0.68, "p50": -0.12, "p75": 0.56, "p90": 1.32}
    try:
        return {**default, **json.loads(path.read_text(encoding="utf-8"))["season"]["zQuantiles"]}
    except (OSError, KeyError, ValueError):
        return default


Z_QUANTILES = _load_z_quantiles()

#: Partidos de esta temporada a partir de los cuales ya no se mira la anterior.
CURRENT_ENOUGH = 5
#: Colchón, en partidos, de la incertidumbre sobre la media de cada jugador:
#: la horquilla se ensancha por √(1 + k/(n + k)), ×1,22 con 2 partidos y ×1,05
#: a final de temporada.
SD_PRIOR_GAMES = 2.0
#: Desviación típica del entrenador: puntúa −20…+25 según el margen.
COACH_SD = 11.0

#: Métricas avanzadas oficiales que se enseñan, en este orden.
#: (clave de salida, campo del v3, etiqueta, mayor es mejor, formato)
OFFICIAL_METRICS: list[tuple[str, str, str, bool, str]] = [
    ("ts", "trueShootingPercentage", "Tiro verdadero (TS%)", True, "pct"),
    ("efg", "effectiveFieldGoalPercentage", "Tiro efectivo (eFG%)", True, "pct"),
    ("orb", "offensiveReboundsPercentage", "Rebote ofensivo", True, "pct"),
    ("drb", "defensiveReboundsPercentage", "Rebote defensivo", True, "pct"),
    ("ast", "assistsRatio", "Ratio de asistencias", True, "pct"),
    ("tov", "turnoversRatio", "Pérdidas por posesión", False, "pct"),
    ("ftr", "freeThrowsRate", "Tiros libres por tiro", True, "pct"),
]


def _pct(value: Any) -> float | None:
    """"47.7%" -> 0.477; 1.1 -> 1.1."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip().replace("%", "")
        try:
            return float(text) / 100.0
        except ValueError:
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _num(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(number) or math.isinf(number) else number


# ---------------------------------------------------------------------------
# Piezas
# ---------------------------------------------------------------------------
def _last_club(gamelog: pd.DataFrame) -> dict[str, str]:
    if gamelog.empty:
        return {}
    ordered = gamelog.sort_values(["utc_date", "game_code"])
    return {str(k): str(v) for k, v in ordered.groupby("person_code")["club_code"].last().items()}


def _projection_sd(
    records: list[dict[str, Any]], current: pd.DataFrame, prior: pd.DataFrame
) -> dict[int, float]:
    """Desviación típica de la puntuación de cada jugador, encogida como la media."""
    def stds(log: pd.DataFrame) -> tuple[dict[str, float], dict[str, int]]:
        if log.empty:
            return {}, {}
        played = log[log["played"]]
        grouped = played.groupby("person_code")["fantasy_points"]
        return grouped.std(ddof=1).fillna(0.0).to_dict(), grouped.size().to_dict()

    sd_now, n_now = stds(current)
    sd_prior, n_prior = stds(prior)
    out: dict[int, float] = {}
    for record in records:
        proj = _num(record.get("projectedIfPlays")) or _num(record.get("projectedFp")) or 0.0
        if record.get("isCoach"):
            out[int(record["id"])] = COACH_SD
            continue
        code = str(record.get("personCode"))
        fallback = max(3.0, 0.5 * proj)
        base = sd_prior.get(code) if n_prior.get(code, 0) >= 5 else None
        base = base if base and base > 0 else fallback
        n = max(n_now.get(code, 0) - 1, 0)
        cur = sd_now.get(code, 0.0)
        weight = n / (n + PRIOR_WEIGHT_GAMES)
        # A la dispersión de sus partidos se suma la duda sobre su propia media,
        # que con pocos partidos es grande: en J2–J3 la horquilla p25–p75
        # recogía el 41 % de los resultados en vez del 50 %.
        widen = math.sqrt(1 + SD_PRIOR_GAMES / (n_now.get(code, 0) + SD_PRIOR_GAMES))
        out[int(record["id"])] = round(widen * math.sqrt(weight * cur**2 + (1 - weight) * base**2), 2)
    return out


PRICE_FRAME_COLUMNS = ["round", "last_fp", "quotation", "plus"]


def round_price_frame(
    history: pd.DataFrame | None,
    crosswalk: pd.DataFrame,
    current: pd.DataFrame,
    games: list[dict[str, Any]],
) -> pd.DataFrame:
    """Para ajustar el modelo de precio: en cada jornada ya revalorizada, la
    variación REAL de la cotización (captura de después menos captura de antes)
    frente a lo que puntuó cada jugador y lo que costaba al empezarla.

    Antes se ajustaba `plus` contra la cotización del último snapshot. Pero
    `plus` es acumulado y esa cotización ya lleva la variación dentro: desde la
    J2 el ajuste salía con R² < 0,8 y se volvía en silencio a los coeficientes
    de la J1. La columna `plus` del resultado es aquí la variación de la jornada.
    """
    empty = pd.DataFrame(columns=PRICE_FRAME_COLUMNS)
    if history is None or history.empty or current.empty or "quotation" not in history.columns:
        return empty
    history = history.assign(_t=pd.to_datetime(history["captured_at"], utc=True))
    stamps = sorted(history["_t"].unique())
    floor = float(pd.to_numeric(history["quotation"], errors="coerce").min())
    played = current[current["played"]]
    rounds: dict[int, list[pd.Timestamp]] = {}
    complete: dict[int, bool] = {}
    for game in games:
        number, stamp = int(game.get("round") or 0), _game_time(game)
        if not number or stamp is None:
            continue
        rounds.setdefault(number, []).append(stamp)
        complete[number] = complete.get(number, True) and bool(game.get("played"))

    frames = []
    for number, times in sorted(rounds.items()):
        if not complete.get(number):
            continue
        before = [s for s in stamps if s < min(times)]
        after = [s for s in stamps if s > max(times) + GAME_DURATION]
        if not before or not after:
            continue
        base = history[history["_t"] == before[-1]][["fantaking_id", "quotation"]]
        post = None
        for stamp in after:
            candidate = history[history["_t"] == stamp][["fantaking_id", "quotation"]]
            joined = base.merge(candidate, on="fantaking_id", suffixes=("_pre", "_post"))
            if len(joined) and float((joined["quotation_pre"] != joined["quotation_post"]).mean()) >= 0.5:
                post = joined
                break
        if post is None:
            continue
        scores = played[played["round"] == number].groupby("person_code")["fantasy_points"].first()
        frame = post.merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id")
        frame["last_fp"] = frame["person_code"].map(scores)
        frame = frame.dropna(subset=["last_fp"])
        # El suelo del juego corta la variación: esas filas no informan de la recta.
        frame = frame[frame["quotation_post"] > floor]
        frames.append(
            pd.DataFrame({
                "round": number,
                "last_fp": frame["last_fp"].astype(float),
                "quotation": frame["quotation_pre"].astype(float),
                "plus": (frame["quotation_post"] - frame["quotation_pre"]).round(2),
            })
        )
    return pd.concat(frames, ignore_index=True) if frames else empty


# ---------------------------------------------------------------------------
# Frescura de los precios y precio pendiente
# ---------------------------------------------------------------------------
#: Un partido dura unas dos horas: lo que empezó antes de captura − 2 h ya
#: estaba reflejado en `plus` cuando se capturó.
GAME_DURATION = pd.Timedelta(hours=2)
#: Lo que el juego resta a quien no juega (J1: −0,1 en todos los casos vistos).
DNP_PRICE_CHANGE = -0.1
#: Variación mínima que se ve como subida: el juego redondea a 0,1.
RISE_STEP = 0.05


def _game_time(game: dict[str, Any]) -> pd.Timestamp | None:
    stamp = pd.to_datetime(game.get("utcDate"), utc=True, errors="coerce")
    return None if pd.isna(stamp) else stamp


def _club(game: dict[str, Any], side: str) -> str | None:
    return ((game.get(side) or {}).get("club") or {}).get("code")


def price_freshness(
    history: pd.DataFrame, games: list[dict[str, Any]]
) -> dict[str, Any]:
    """¿El último snapshot ya lleva la revalorización de la última jornada jugada?

    El juego calcula la variación (`plus`) en cuanto acaba cada partido, pero no
    la aplica a la cotización hasta que se cierra la jornada. Hay dos formas de
    quedarse con precios viejos, y las dos pasaron con la J1:

      1. capturar con la jornada a medias (partidos jugados después de la captura);
      2. capturar con la jornada terminada pero antes de que el juego aplique los
         precios: los que tienen `plus` ≠ 0 siguen con la cotización de antes de
         la jornada.
    """
    empty = {"stale": False, "capturedAt": None, "lastGameAt": None, "round": None, "reason": None}
    if history.empty or "quotation" not in history.columns:
        return empty
    captured = pd.to_datetime(history["captured_at"], utc=True).max()
    played = [(g, _game_time(g)) for g in games if g.get("played") and _game_time(g) is not None]
    out = {**empty, "capturedAt": captured.isoformat()}
    if not played:
        return out

    last_round = max(int(g.get("round") or 0) for g, _ in played)
    in_round = [t for g, t in played if int(g.get("round") or 0) == last_round]
    out["round"] = last_round
    out["lastGameAt"] = max(t for _, t in played).isoformat()

    if any(t >= captured - GAME_DURATION for t in in_round):
        return {**out, "stale": True, "reason": "captura con la jornada a medias"}

    # Jornada terminada antes de capturar: ¿se aplicó ya la variación? `plus` es
    # acumulado desde el inicio de temporada, así que lo que se mueve en esta
    # jornada es lo que ha cambiado `plus` respecto a la captura de antes.
    latest = history[history["captured_at"] == captured]
    before = history[history["captured_at"] < min(in_round)]
    if before.empty or "plus" not in latest.columns:
        return out
    base = before[before["captured_at"] == before["captured_at"].max()]
    merged = latest.merge(
        base[["fantaking_id", "quotation", "plus"]], on="fantaking_id", suffixes=("", "_base")
    )
    moved = (
        pd.to_numeric(merged["plus"], errors="coerce").fillna(0)
        - pd.to_numeric(merged["plus_base"], errors="coerce").fillna(0)
    ).round(2)
    movers = merged[moved.ne(0)]
    if len(movers) >= 20 and float((movers["quotation"] != movers["quotation_base"]).mean()) < 0.5:
        return {**out, "stale": True, "reason": "el juego aún no ha aplicado la revalorización"}
    return out


def round_plus_base(
    history: pd.DataFrame | None, games: list[dict[str, Any]], round_number: int
) -> dict[int, float]:
    """`plus` de cada jugador justo antes del primer partido de la jornada.

    `plus` NO es la variación de la jornada: es la acumulada desde el precio de
    salida (cotización − cotización inicial), más la provisional de la jornada en
    curso. Comprobado con los snapshots de la J2 y la J3: tras cada
    revalorización, `plus` = cotización − la del 24-09 en los 350 jugadores. Lo
    que se mueve en la jornada es, por tanto, `plus` ahora menos `plus` antes.

    Quien no está en la captura de antes (llegó al mercado después) usa su
    acumulado hasta entonces: su cotización de entrada menos la primera vista.
    """
    if history is None or history.empty or "plus" not in history.columns:
        return {}
    starts = [
        t for g in games
        if int(g.get("round") or 0) == round_number and (t := _game_time(g)) is not None
    ]
    if not starts:
        return {}
    stamps = pd.to_datetime(history["captured_at"], utc=True)
    before = history[stamps < min(starts)]
    if before.empty:
        return {}
    base = before[pd.to_datetime(before["captured_at"], utc=True) == pd.to_datetime(before["captured_at"], utc=True).max()]
    return {
        int(pid): float(value)
        for pid, value in zip(base["fantaking_id"], pd.to_numeric(base["plus"], errors="coerce"), strict=False)
        if not pd.isna(value)
    }


def _first_quotes(history: pd.DataFrame | None) -> dict[int, float]:
    """Primera cotización vista de cada jugador (su precio de salida)."""
    if history is None or history.empty or "quotation" not in history.columns:
        return {}
    ordered = history.sort_values("captured_at")
    first = ordered.groupby("fantaking_id")["quotation"].first()
    return {int(k): float(v) for k, v in first.items() if not pd.isna(v)}


def pending_prices(
    records: list[dict[str, Any]],
    market: pd.DataFrame,
    log_now: pd.DataFrame,
    games: list[dict[str, Any]],
    model: dict[str, Any],
    freshness: dict[str, Any],
    history: pd.DataFrame | None = None,
) -> int:
    """Rellena `pricePending`: la cotización que tendrá cada uno al cerrar la jornada.

    Quien ya había jugado al capturar lleva la variación del propio juego: lo
    que ha cambiado su `plus` (acumulado) desde antes de la jornada. Quien jugó
    después, la del modelo de precio con su puntuación real; quien no jugó, lo
    que el juego resta en ese caso. Devuelve cuántos cambian.

    Sin `history` se supone que `plus` empezaba la jornada en 0, que solo es
    cierto en la J1.
    """
    if not freshness.get("stale") or freshness.get("round") is None:
        return 0
    captured = pd.to_datetime(freshness["capturedAt"], utc=True)
    last_round = int(freshness["round"])
    club_game: dict[str, tuple[int, pd.Timestamp]] = {}
    for game in games:
        stamp = _game_time(game)
        if int(game.get("round") or 0) != last_round or not game.get("played") or stamp is None:
            continue
        for side in ("local", "road"):
            club = _club(game, side)
            if club:
                club_game[club] = (int(game["gameCode"]), stamp)
    plus_base = round_plus_base(history, games, last_round)
    first_quote = _first_quotes(history)

    fp: dict[tuple[str, int], float] = {}
    if not log_now.empty:
        played = log_now[log_now["played"]]
        fp = {
            (str(person), int(code)): float(points)
            for person, code, points in played[["person_code", "game_code", "fantasy_points"]].itertuples(index=False)
        }
    plus = (
        dict(zip(market["fantaking_id"].astype(int), pd.to_numeric(market["plus"], errors="coerce"), strict=False))
        if "plus" in market.columns
        else {}
    )

    # El juego no baja de su precio mínimo (4,0 en la 2026-27): el modelo sí lo haría.
    quotes = pd.to_numeric(market.get("quotation"), errors="coerce") if "quotation" in market.columns else None
    floor = float(quotes.min()) if quotes is not None and quotes.notna().any() else 0.0

    changed = 0
    for record in records:
        price = _num(record.get("price"))
        game = club_game.get(str(record.get("club")))
        if price is None or price <= 0 or game is None:
            continue
        code, stamp = game
        if stamp < captured - GAME_DURATION:
            pid = int(record["id"])
            total, source = plus.get(pid), "juego"
            if total is None or pd.isna(total):
                continue
            if pid in plus_base:
                start = plus_base[pid]
            elif pid in first_quote:
                start = price - first_quote[pid]
            else:
                start = 0.0
            delta = float(total) - start
        elif record.get("isCoach"):
            continue  # su variación depende del marcador y no hay modelo para ella
        else:
            points = fp.get((str(record.get("personCode")), code))
            source = "modelo"
            delta = (
                DNP_PRICE_CHANGE
                if points is None
                else max(-1.5, min(1.5, expected_change(model, points, price)))
            )
        pending = round(max(floor, price + float(delta)), 1)
        if pending != price:
            record["pricePending"] = pending
            record["pricePendingSource"] = source
            changed += 1
    return changed


#: Partidos a partir de los cuales la fiabilidad sale de su propia dispersión.
RELIABILITY_MIN_GAMES = 3


def _early_reliability(records: list[dict[str, Any]]) -> None:
    """Fiabilidad estimada mientras no hay 3 partidos: 1 − σ/proyección, con la σ
    encogida hacia el año pasado (la misma que usa la horquilla). Antes la tabla
    enseñaba "—" en las 330 filas hasta la tercera jornada."""
    for record in records:
        perf = record.get("perf") or {}
        outlook = record.get("outlook") or {}
        proj = _num(record.get("projectedFp")) or 0.0
        if (perf.get("gamesPlayed") or 0) >= RELIABILITY_MIN_GAMES or not outlook or proj <= 0:
            continue
        perf["consistency"] = round(max(0.0, min(1.0, 1 - outlook["sd"] / proj)), 3)
        perf["consistencyEstimated"] = True


def _rebuild_bargain(records: list[dict[str, Any]]) -> None:
    """Recalcula el índice de chollo con la probabilidad de subir ya calculada."""
    from efa.metrics import bargain_score

    frame = pd.DataFrame(
        {
            "value_projected": [_num(r.get("valueProjected")) for r in records],
            "projected_fp": [_num(r.get("projectedFp")) for r in records],
            "consistency": [_num((r.get("perf") or {}).get("consistency")) for r in records],
            "minutes_share_trend": [_num((r.get("perf") or {}).get("minutesShareTrend")) for r in records],
            "rise_prob": [_num((r.get("outlook") or {}).get("riseProb")) for r in records],
        }
    )
    for record, score in zip(records, bargain_score(frame), strict=True):
        if record.get("bargainScore") is not None:
            record["bargainScore"] = float(score)


# ---------------------------------------------------------------------------
# Todo junto
# ---------------------------------------------------------------------------
def _coach_outcomes(record: dict[str, Any], meta: dict[str, Any]) -> list[tuple[float, float]] | None:
    """Reparto de puntos del entrenador en su próximo partido, si lo hay."""
    if not record.get("isCoach"):
        return None
    nxt = (record.get("schedule") or {}).get("next")
    sd = (meta.get("matchModel") or {}).get("marginSd")
    if not nxt or not sd or nxt.get("expectedMargin") is None:
        return None
    return coach_outcomes(float(nxt["expectedMargin"]), float(sd))


def apply_advanced(
    *,
    records: list[dict[str, Any]],
    details: dict[str, dict[str, Any]],
    teams: list[dict[str, Any]],
    meta: dict[str, Any],
    market: pd.DataFrame,
    crosswalk: pd.DataFrame,
    reference: dict[str, Any],
    round_now: int,
    history: pd.DataFrame | None = None,
) -> None:
    """Muta los cuatro objetos añadiendo la capa avanzada."""
    prior_reference = load_reference(PRIOR_SEASON_CODE)
    box_now = season_boxscores(SEASON_CODE)
    box_prior = season_boxscores(PRIOR_SEASON_CODE)
    log_now = season_gamelog(SEASON_CODE)
    log_prior = season_gamelog(PRIOR_SEASON_CODE)
    games_now = {str(k): int(v) for k, v in (log_now[log_now["played"]].groupby("person_code").size().items() if not log_now.empty else [])}
    club_prior = _last_club(log_prior)
    club_now = _last_club(log_now)
    by_code = {str(r["personCode"]): r for r in records if r.get("personCode")}
    id_by_code = {code: int(r["id"]) for code, r in by_code.items()}

    # Minutos del año pasado: con pocas jornadas, "rol al alza" se mide contra
    # su temporada anterior, no contra unas últimas jornadas que no existen.
    minutes_prior = (
        log_prior[log_prior["played"]].groupby("person_code")["minutes"].mean().to_dict()
        if not log_prior.empty
        else {}
    )
    for record in records:
        value = minutes_prior.get(str(record.get("personCode")))
        record.setdefault("perf", {})["minutesPrior"] = round(float(value), 1) if value is not None else None

    # ------------------------------------------------------------ precio
    calendar = reference.get("games", [])
    price_rows = round_price_frame(history, crosswalk, log_now, calendar)
    rounds_fit = sorted(int(r) for r in price_rows["round"].unique()) if not price_rows.empty else []
    label = (
        f"J{rounds_fit[0]}" if len(rounds_fit) == 1
        else f"J{rounds_fit[0]}–J{rounds_fit[-1]}" if rounds_fit
        else "J1"
    )
    model = fit_price_model(price_rows, source=label)
    freshness = price_freshness(history if history is not None else market, calendar)
    pending = pending_prices(records, market, log_now, calendar, model, freshness, history=history)
    meta["priceFreshness"] = {**freshness, "pending": pending}
    if freshness.get("stale"):
        meta.setdefault("warnings", []).append(
            f"Precios capturados el {freshness['capturedAt'][:16].replace('T', ' ')} UTC: "
            f"{freshness['reason']} (J{freshness['round']}). "
            f"Se usa el precio pendiente de {pending} jugadores hasta la próxima captura."
        )
    sds = _projection_sd(records, log_now, log_prior)
    #: σ de lo que hace SI juega, antes de mezclar con el riesgo de no jugar: es
    #: la que decide si supera el umbral cuando juega.
    sd_if_plays = dict(sds)
    for record in records:
        # Puede no jugar: la puntuación es una mezcla (0 con probabilidad 1-p, su
        # normal con probabilidad p). Var = p·σ² + p(1-p)·μ², con μ lo que hace
        # si juega. Sin esto, una duda salía con la horquilla de un fijo.
        prob, cond, sd0 = record.get("playProb"), _num(record.get("projectedIfPlays")), sds.get(int(record["id"]))
        if prob is not None and cond is not None and sd0 is not None and 0 <= prob < 1:
            sds[int(record["id"])] = round(math.sqrt(prob * sd0**2 + prob * (1 - prob) * cond**2), 2)
        # Puntos por crédito con la proyección final (disponibilidad incluida) y
        # al precio que se paga.
        pay, proj = _num(record.get("pricePending")) or _num(record.get("price")), _num(record.get("projectedFp"))
        if pay and proj is not None:
            record["valueProjected"] = round(proj / pay, 3)
    for record in records:
        # El umbral de la próxima jornada se mide contra el precio que tendrá, no
        # contra uno que el juego ya ha dejado atrás.
        price = _num(record.get("pricePending")) or _num(record.get("price"))
        proj = _num(record.get("projectedFp"))
        sd = sds.get(int(record["id"]))
        if price is None or price <= 0 or proj is None or sd is None:
            record["outlook"] = None
            continue
        threshold = break_even(model, price)
        outcomes = _coach_outcomes(record, meta)
        if outcomes is not None:
            # El entrenador solo puede sacar seis cifras: su horquilla es la de
            # esa distribución discreta, no la de una normal.
            record["outlook"] = {
                "breakEven": round(threshold, 1),
                "expectedChange": round(max(-1.5, min(1.5, expected_change(model, proj, price))), 2),
                "riseProb": round(coach_prob_above(outcomes, threshold), 3),
                "sd": round(coach_sd(outcomes), 2),
                "floor": coach_quantile(outcomes, 0.25),
                "ceiling": coach_quantile(outcomes, 0.75),
                "p90": coach_quantile(outcomes, 0.9),
            }
            continue
        # Subir es que la variación redondeada sea al menos +0,1, no que pase de
        # 0: eso pide unos puntos más que el umbral. Y solo puede subir si juega:
        # quien no juega pierde 0,1. Antes se evaluaba la normal de la proyección
        # mezclada (que ya descuenta los ceros) contra el umbral, y en J2–J3 el
        # tramo "40-60 %" subía el 36 % de las veces y el "20-40 %", el 13 %.
        prob = record.get("playProb")
        prob = 1.0 if prob is None else float(prob)
        cond = _num(record.get("projectedIfPlays"))
        cond = proj if cond is None else cond
        sd_cond = sd_if_plays.get(int(record["id"])) or sd
        rise_at = threshold + RISE_STEP / model["a"]
        expected = prob * expected_change(model, cond, price) + (1 - prob) * DNP_PRICE_CHANGE
        record["outlook"] = {
            "breakEven": round(threshold, 1),
            "expectedChange": round(max(-1.5, min(1.5, expected)), 2),
            "riseProb": round(prob * prob_above(rise_at, cond, sd_cond), 3),
            "sd": sd,
            # Cuantiles empíricos del backtest, no ±0,674σ: la puntuación tiene
            # la cola de arriba más larga que la de abajo.
            "floor": round(max(0.0, proj + Z_QUANTILES["p25"] * sd), 1),
            "ceiling": round(proj + Z_QUANTILES["p75"] * sd, 1),
            "p90": round(proj + Z_QUANTILES["p90"] * sd, 1),
        }
    meta["priceModel"] = {**DEFAULT_PRICE_MODEL, **model}
    _early_reliability(records)
    _rebuild_bargain(records)

    # ------------------------------------------------------------ tiros
    shots_now = add_zones(shots_frame(SEASON_CODE))
    shots_prior = add_zones(shots_frame(PRIOR_SEASON_CODE))
    shots_all = pd.concat([shots_prior, shots_now], ignore_index=True)
    league_zones = zone_table(shots_all)
    by_player_all = dict(tuple(shots_all.groupby("player"))) if not shots_all.empty else {}
    by_player_now = dict(tuple(shots_now.groupby("player"))) if not shots_now.empty else {}

    # ---------------------------------------------------------- en pista
    court_now = player_court_stats(analyse_season(load_pbp(SEASON_CODE), box_now))
    court_prior = player_court_stats(analyse_season(load_pbp(PRIOR_SEASON_CODE), box_prior))

    # ------------------------------------------------------------- mezcla
    mix_now = fantasy_mix(log_now)
    mix_prior = fantasy_mix(log_prior)

    # --------------------------------------------------------- oficiales
    official_now = _official_table(load_player_stats(SEASON_CODE), reference)
    official_prior = _official_table(load_player_stats(PRIOR_SEASON_CODE), prior_reference)

    for record in records:
        key = str(record["id"])
        detail = details.setdefault(key, {})
        code = record.get("personCode")
        if not code or record.get("isCoach"):
            continue
        code = str(code)
        n_now = games_now.get(code, 0)

        # Tiros: dos temporadas siempre (el tiro viaja con el jugador).
        mine = by_player_all.get(code)
        if mine is not None and len(mine):
            now = by_player_now.get(code)
            detail["shots"] = {
                "seasons": [s for s, frame in ((PRIOR_SEASON_CODE, shots_prior), (SEASON_CODE, shots_now)) if not frame.empty and code in set(frame["player"])],
                "zones": zone_table(mine),
                "current": zone_table(now) if now is not None else [[0, 0] for _ in ZONES],
                "dots": (
                    now[["x", "y", "made", "value"]].astype(int).values.tolist() if now is not None else []
                ),
                "profile": {
                    "attempts": int(len(mine)),
                    "pointsPerShot": round(float((mine["made"] * mine["value"]).sum()) / len(mine), 3),
                    "threeRate": round(float((mine["value"] == 3).mean()), 3),
                    "rimRate": round(float((mine["zone"] == "rim").mean()), 3),
                    "fastbreak": round(float(mine["fastbreak"].mean()), 3),
                    "secondChance": round(float(mine["secondChance"].mean()), 3),
                },
            }

        # En pista: esta temporada; si aún son pocos partidos y sigue en el
        # mismo club, se suma la anterior (mismo contexto, mismo entrenador…).
        now_row = court_now.get(code)
        prior_row = court_prior.get(code)
        same_club = club_prior.get(code) and club_prior.get(code) == (club_now.get(code) or record.get("club"))
        if now_row and (now_row["games"] >= CURRENT_ENOUGH or not (prior_row and same_club)):
            detail["court"] = {**now_row, "seasons": [SEASON_CODE]}
        elif prior_row and same_club:
            detail["court"] = {**_merge_court(prior_row, now_row), "seasons": [PRIOR_SEASON_CODE] + ([SEASON_CODE] if now_row else [])}
        elif now_row:
            detail["court"] = {**now_row, "seasons": [SEASON_CODE]}

        # Mezcla fantasy: esta temporada desde 3 partidos; si no, la anterior.
        if n_now >= 3 and code in mix_now:
            detail["mix"] = {**mix_now[code], "season": SEASON_CODE}
        elif code in mix_prior and mix_prior[code]["games"] >= 5:
            detail["mix"] = {**mix_prior[code], "season": PRIOR_SEASON_CODE}
        elif code in mix_now:
            detail["mix"] = {**mix_now[code], "season": SEASON_CODE}

        # Avanzadas oficiales: igual.
        off_now = official_now.get(code)
        off_prior = official_prior.get(code)
        if off_now and (off_now["games"] >= 3 or not off_prior):
            detail["official"] = {**off_now, "season": SEASON_CODE}
        elif off_prior:
            detail["official"] = {**off_prior, "season": PRIOR_SEASON_CODE}

    # ------------------------------------------------------------- clubs
    positions = player_positions(
        [reference, prior_reference],
        ((r.get("personCode"), r.get("position")) for r in records if r.get("position") in ("G", "F", "C")),
    )
    allowed = blend_allowed(allowed_by_position(log_now, positions), allowed_by_position(log_prior, positions))
    q_now = quarter_splits(reference.get("games", []))
    q_prior = quarter_splits(prior_reference.get("games", []))
    lineups = team_lineups(analyse_season(load_pbp(SEASON_CODE), box_now))
    names = _short_names(reference)
    upcoming = _upcoming(reference.get("games", []), round_now, horizon=5)

    for team in teams:
        code = team["code"]
        team["allowed"] = allowed["clubs"].get(code)
        team["upcoming"] = upcoming.get(code, [])
        team["quarters"] = {
            "current": q_now.get(code),
            "prior": q_prior.get(code),
            "currentSeason": SEASON_CODE,
            "priorSeason": PRIOR_SEASON_CODE,
        }
        team["lineups"] = [
            {
                **lineup,
                "names": [names.get(p, p) for p in lineup["players"]],
                "ids": [id_by_code.get(p) for p in lineup["players"]],
            }
            for lineup in lineups.get(code, [])
        ]

    meta["league"] = {
        "zones": league_zones,
        "zoneKeys": [key for key, _ in ZONES],
        "zoneLabels": [label for _, label in ZONES],
        "allowed": allowed["league"],
        "shotSeasons": [s for s, frame in ((PRIOR_SEASON_CODE, shots_prior), (SEASON_CODE, shots_now)) if not frame.empty],
        "seasonLabels": {SEASON_CODE: season_label(SEASON_CODE), PRIOR_SEASON_CODE: season_label(PRIOR_SEASON_CODE)},
    }
    log.info(
        "Capa avanzada: modelo de precio %s (R² %.3f, n=%d) · %d tiros · on/off de %d jugadores",
        model.get("source"), model.get("r2", 0), model.get("n", 0), len(shots_all), len(court_now),
    )


def _merge_court(prior: dict[str, Any], now: dict[str, Any] | None) -> dict[str, Any]:
    """Suma dos temporadas de minutos y on/off, ponderando por partidos."""
    if not now:
        return dict(prior)
    g1, g2 = prior["games"], now["games"]
    total = g1 + g2

    def avg(a: float | None, b: float | None, w1: float, w2: float) -> float | None:
        if a is None:
            return b
        if b is None:
            return a
        return round((a * w1 + b * w2) / (w1 + w2), 1)

    on1, on2 = prior["onOff"], now["onOff"]
    return {
        "games": total,
        "minutes": avg(prior["minutes"], now["minutes"], g1, g2),
        "periodMinutes": [avg(a, b, g1, g2) for a, b in zip(prior["periodMinutes"], now["periodMinutes"], strict=False)],
        "clutchMinutes": avg(prior["clutchMinutes"], now["clutchMinutes"], g1, g2),
        "clutchGames": prior["clutchGames"] + now["clutchGames"],
        "usage": avg(prior.get("usage"), now.get("usage"), g1, g2),
        "onOff": {
            key: avg(on1.get(key), on2.get(key), on1.get("onPoss") or 1, on2.get("onPoss") or 1)
            for key in ("onNet", "offNet", "onOrtg", "onDrtg", "offOrtg", "offDrtg", "diff")
        }
        | {"onPoss": round((on1.get("onPoss") or 0) + (on2.get("onPoss") or 0), 1),
           "offPoss": round((on1.get("offPoss") or 0) + (on2.get("offPoss") or 0), 1)},
    }


def _official_table(stats: dict[str, list[dict[str, Any]]], reference: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """person_code -> métricas oficiales con su percentil dentro de su puesto."""
    advanced = {str((row.get("player") or {}).get("code")): row for row in stats.get("advanced", [])}
    misc = {str((row.get("player") or {}).get("code")): row for row in stats.get("misc", [])}
    if not advanced:
        return {}
    position = {
        str((entry.get("person") or {}).get("code")): normalize_position(entry.get("positionName"))
        for entry in reference.get("players", [])
    }
    rows = []
    for code, row in advanced.items():
        games = _num(row.get("gamesPlayed")) or 0
        minutes = _num(row.get("minutesPlayed")) or 0
        values = {key: _pct(row.get(field)) for key, field, *_ in OFFICIAL_METRICS}
        rows.append({"code": code, "pos": position.get(code), "games": games, "minutes": minutes, **values})
    frame = pd.DataFrame(rows)
    # Población de referencia: rotación real (10+ minutos). Un 100 % de tiro
    # en 2 minutos no puede fijar el percentil de nadie.
    min_games = max(1.0, min(10.0, float(frame["games"].max()) * 0.4))
    pool = frame[(frame["minutes"] >= 10) & (frame["games"] >= min_games)]

    out: dict[str, dict[str, Any]] = {}
    for row in frame.itertuples():
        group = pool[pool["pos"] == row.pos] if row.pos else pool
        if len(group) < 8:
            group = pool
        metrics = []
        for key, _field, label, higher, fmt in OFFICIAL_METRICS:
            value = getattr(row, key)
            if value is None or (isinstance(value, float) and math.isnan(value)):
                continue
            column = group[key].dropna()
            pct = float((column < value).mean() + 0.5 * (column == value).mean()) if len(column) else None
            if pct is not None and not higher:
                pct = 1 - pct
            metrics.append({"key": key, "label": label, "value": round(float(value), 4), "format": fmt,
                            "percentile": round(pct, 3) if pct is not None else None, "higherIsBetter": higher})
        extra = misc.get(row.code) or {}
        out[row.code] = {
            "games": int(row.games),
            "minutes": round(float(row.minutes), 1),
            "doubleDoubles": int(_num(extra.get("doubleDoubles")) or 0),
            "starts": int(_num(extra.get("gamesStarted")) or 0),
            "position": row.pos,
            "poolSize": int(len(pool[pool["pos"] == row.pos])) if row.pos else int(len(pool)),
            "metrics": metrics,
        }
    return out


def _short_names(reference: dict[str, Any]) -> dict[str, str]:
    """person_code -> apellido capitalizado ("VEZENKOV, SASHA" -> "Vezenkov")."""
    out = {}
    for entry in reference.get("players", []):
        person = entry.get("person") or {}
        name = str(person.get("name") or "")
        surname = name.split(",")[0].strip() if "," in name else name.split(" ")[-1]
        out[str(person.get("code"))] = " ".join(w.capitalize() for w in surname.split())
    return out


def _upcoming(games: list[dict[str, Any]], round_now: int, *, horizon: int) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    rounds = sorted({int(g["round"]) for g in games if g.get("round") and not g.get("played") and int(g["round"]) >= round_now})[:horizon]
    for game in sorted(games, key=lambda g: (int(g.get("round") or 0), str(g.get("utcDate") or ""))):
        if not game.get("round") or int(game["round"]) not in rounds or game.get("played"):
            continue
        local = str(((game.get("local") or {}).get("club") or {}).get("code") or "")
        road = str(((game.get("road") or {}).get("club") or {}).get("code") or "")
        for club, opp, home in ((local, road, True), (road, local, False)):
            out.setdefault(club, []).append(
                {"round": int(game["round"]), "opponent": opp, "home": home, "date": game.get("utcDate")}
            )
    return out

