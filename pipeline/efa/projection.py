"""Proyección v2: minutos esperados × producción por minuto × rival × cancha.

La proyección de antes era una media de puntos con retoques (forma, tendencia
de minutos). Esta separa las dos cosas que se mueven a ritmos distintos:

  - los MINUTOS cambian rápido (rol, rotación, lesiones de compañeros): media
    exponencial de los últimos partidos;
  - la PRODUCCIÓN POR MINUTO es estable: suma de puntos entre suma de minutos,
    encogida hacia la que descuenta su precio y la de su puesto, con un colchón
    en minutos, no en partidos.

En las primeras jornadas de una temporada, la anterior hace de referencia de
las dos cosas (ver `config.PRIOR_SEASON_ROUNDS`).

Encima, dos ajustes de contexto medidos en los propios datos:

  - RIVAL: lo que concede cada club a cada puesto frente a la media de la
    liga, encogido según los partidos que lleva;
  - CANCHA: el factor local/visitante de toda la liga.

`backtest()` predice cada partido de una temporada solo con los anteriores y
compara con el modelo de antes. Los parámetros de `PARAMS` salen de ahí: una
rejilla de 27 combinaciones sobre la 2025-26 (7.924 partidos) dio el mejor
error medio con el rival al 50 %, 100 min de colchón y vida media de 3
partidos: 5,945 frente a 6,072 del modelo de antes y 6,098 de la media.

En octubre de 2026 lo publicado sobreestimaba +0,49 en J2–J6 (sobre todo a los
caros): los minutos del año pasado no contaban con rotaciones más largas. Con
`league_minutes_scale` y el colchón de minutos en 1, y el tope de 0,95 a la
probabilidad de jugar por historial (config.PLAY_SHARE_CAP), la reconstrucción
de lo publicado pasa de MAE 4,519 / sesgo +0,49 a 4,444 / +0,01, con el
Spearman igual (0,608 → 0,610).
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

#: Peso del precio (frente al puesto) en la producción de referencia.
PRICE_RATE_WEIGHT = 0.75
#: Minutos jugados esta temporada para entrar en las rectas de precio.
PRICE_FIT_MIN_MINUTES = 60.0


@dataclass(frozen=True)
class Params:
    #: Colchón de la producción por minuto, en minutos jugados: con 100 min
    #: (unos cuatro partidos) pesa a medias lo de ahora y la referencia.
    rate_prior_minutes: float = 100.0
    #: Vida media, en partidos, de la media exponencial de minutos.
    minutes_half_life: float = 3.0
    #: Colchón de los minutos, en partidos, hacia los del año pasado. Era 2;
    #: con 1 pesan antes los de esta temporada (ver `league_minutes_scale`).
    minutes_prior_games: float = 1.0
    #: Colchón del factor rival, en partidos del rival.
    opponent_prior_games: float = 8.0
    #: Cuánto del factor rival se aplica (0 = nada, 1 = entero).
    opponent_weight: float = 0.5
    #: Aplicar el factor cancha medido.
    use_home: bool = True
    #: Escalar los minutos de referencia (año pasado o precio) por lo que ha
    #: cambiado el minuto medio por partido jugado en la liga. En la 2026-27 las
    #: rotaciones son más largas (11,4 jugadores por partido frente a 10,9) y los
    #: minutos del año pasado sobraban: +0,35 de sesgo en el backtest.
    league_minutes_scale: bool = True


PARAMS = Params()

#: Primera jornada que el modelo predice con los parámetros ya fijados. Todo lo
#: de arriba (y los topes y colchones de `config`) se ajustó mirando las
#: jornadas 2 a 10 de la 2026-27, así que el error medido en ellas es optimista:
#: el modelo ya "había visto" esos resultados. Desde esta jornada no se ha
#: tocado nada, y el backtest la publica aparte (`afterFreeze`). Si se vuelve a
#: ajustar un parámetro, hay que mover este número a la jornada siguiente.
PARAMS_FROZEN_ROUND = 11

#: Tramos de proyección para las horquillas, y filas mínimas para fiarse.
BAND_BINS = 5
BAND_MIN_ROWS = 300
BAND_QUANTILES = (0.1, 0.25, 0.75, 0.9)


# ---------------------------------------------------------------------------
# Piezas
# ---------------------------------------------------------------------------
def _ewm_last(values: np.ndarray, half_life: float) -> float:
    weights = 0.5 ** (np.arange(len(values))[::-1] / half_life)
    return float((values * weights).sum() / weights.sum())


def player_state(history: pd.DataFrame, half_life: float) -> pd.DataFrame:
    """Por jugador: partidos jugados, puntos y minutos totales, minutos recientes."""
    cols = ["n", "fp_sum", "min_sum", "min_ewm", "min_avg"]
    if history is None or history.empty:
        return pd.DataFrame(columns=cols, index=pd.Index([], name="person_code"))
    played = history[history["played"]].sort_values(["person_code", "utc_date", "game_code"])
    if played.empty:
        return pd.DataFrame(columns=cols, index=pd.Index([], name="person_code"))
    grouped = played.groupby("person_code", sort=False)
    out = pd.DataFrame({
        "n": grouped.size(),
        "fp_sum": grouped["fantasy_points"].sum(),
        "min_sum": grouped["minutes"].sum(),
        "min_avg": grouped["minutes"].mean(),
    })
    ewm = grouped["minutes"].transform(lambda m: m.ewm(halflife=half_life).mean())
    out["min_ewm"] = ewm.groupby(played["person_code"]).last()
    out.index = out.index.astype(str)
    out.index.name = "person_code"
    return out[cols]


def position_rates(history: pd.DataFrame, positions: dict[str, str]) -> dict[str, float]:
    """Producción por minuto de cada puesto (y de toda la liga, clave "all")."""
    played = history[history["played"] & (history["minutes"] > 0)] if not history.empty else history
    if played is None or played.empty:
        return {}
    pos = played["person_code"].map(positions)
    out = {"all": float(played["fantasy_points"].sum() / played["minutes"].sum())}
    for p in ("G", "F", "C"):
        mask = pos == p
        if mask.any():
            out[p] = float(played.loc[mask, "fantasy_points"].sum() / played.loc[mask, "minutes"].sum())
    return out


def opponent_index(history: pd.DataFrame, positions: dict[str, str], prior_games: float) -> dict[tuple[str, str], float]:
    """(club, puesto) -> índice de lo que concede frente a la media, encogido a 1."""
    if history.empty:
        return {}
    played = history[history["played"]].copy()
    played["pos"] = played["person_code"].map(positions)
    played = played[played["pos"].isin(["G", "F", "C"])]
    if played.empty:
        return {}
    per_game = played.groupby(["opponent_code", "game_code", "pos"])["fantasy_points"].sum().reset_index()
    league = per_game.groupby("pos")["fantasy_points"].mean()
    by_club = per_game.groupby(["opponent_code", "pos"])["fantasy_points"].agg(["mean", "size"])
    out: dict[tuple[str, str], float] = {}
    for (club, pos), row in by_club.iterrows():
        base = float(league.get(pos, 0.0))
        if base <= 0:
            continue
        raw = float(row["mean"]) / base
        n = float(row["size"])
        out[(str(club), str(pos))] = (n * raw + prior_games * 1.0) / (n + prior_games)
    return out


def home_factor(history: pd.DataFrame) -> tuple[float, float]:
    """(factor local, factor visitante) de la producción por minuto en la liga."""
    played = history[history["played"] & (history["minutes"] > 0)] if not history.empty else history
    if played is None or played.empty or played["is_home"].nunique() < 2:
        return 1.0, 1.0
    rate = played.groupby("is_home").apply(lambda g: g["fantasy_points"].sum() / g["minutes"].sum())
    mean = float(played["fantasy_points"].sum() / played["minutes"].sum())
    return float(rate.get(True, mean) / mean), float(rate.get(False, mean) / mean)


# ---------------------------------------------------------------------------
# Proyección
# ---------------------------------------------------------------------------
def project(
    targets: pd.DataFrame,
    history: pd.DataFrame,
    prior: pd.DataFrame | None,
    positions: dict[str, str],
    params: Params = PARAMS,
    *,
    implied_prior: dict[str, dict[str, float]] | None = None,
) -> pd.DataFrame:
    """Proyección para cada fila de `targets` (person_code, opponent_code, is_home).

    `history`: partidos de esta temporada ANTERIORES al objetivo.
    `prior`: partidos de la temporada anterior (o None).
    `implied_prior`: person_code -> {"rate", "minutes"} para quien no tiene año
    pasado (en producción, lo que descuenta su precio).

    Devuelve las columnas `projection`, `minutes`, `rate`, `opp`, `home`.
    """
    now = player_state(history, params.minutes_half_life)
    before = player_state(prior, params.minutes_half_life) if prior is not None else now.iloc[0:0]
    has_prior = prior is not None and not prior.empty
    # Sin año pasado, las medias de puesto salen de esta temporada desde el
    # primer partido; antes se quedaban vacías y todo el mundo partía de 0,5.
    rates = position_rates(history, positions) if len(history) > 2000 or not has_prior else {}
    if has_prior:
        prior_rates = position_rates(prior, positions)
        # Con poca temporada, las medias de puesto también salen del año pasado.
        rates = {**prior_rates, **rates} if rates else prior_rates
    opp = opponent_index(pd.concat([prior, history]) if prior is not None else history, positions,
                         params.opponent_prior_games)
    home_f, away_f = home_factor(pd.concat([prior, history]) if prior is not None else history) if params.use_home else (1.0, 1.0)
    league_rate = rates.get("all", 0.5)

    # Minuto medio por partido jugado de esta temporada frente al del año
    # pasado: escala los minutos de referencia. Hace falta una jornada entera.
    minutes_scale = 1.0
    if params.league_minutes_scale and has_prior and not history.empty:
        now_played, prior_played = history[history["played"]], prior[prior["played"]]
        if len(now_played) >= 150 and len(prior_played):
            minutes_scale = float(now_played["minutes"].mean()) / float(prior_played["minutes"].mean())

    out = []
    for row in targets.itertuples(index=False):
        code = str(row.person_code)
        pos = positions.get(code)
        pos_rate = rates.get(pos, league_rate) if pos else league_rate

        # Referencias: el año pasado (si jugó lo bastante) o lo que haya.
        b = before.loc[code] if code in before.index else None
        implied = (implied_prior or {}).get(code)
        if b is not None and b["min_sum"] >= 100:
            ref_rate, ref_minutes = b["fp_sum"] / b["min_sum"], float(b["min_avg"])
        elif implied:
            ref_rate, ref_minutes = implied["rate"], implied["minutes"]
        else:
            ref_rate, ref_minutes = pos_rate, None
        if ref_minutes is not None:
            ref_minutes *= minutes_scale

        n = now.loc[code] if code in now.index else None
        if n is not None:
            m0 = params.rate_prior_minutes
            rate = (n["fp_sum"] + m0 * ref_rate) / (n["min_sum"] + m0)
            # Sin año pasado, sus minutos son los suyos: encogerlos hacia los que
            # descuenta su precio subía el sesgo (+0,12 frente a +0,03, J4–J10).
            if ref_minutes is None or not has_prior:
                minutes = float(n["min_ewm"])
            else:
                k = params.minutes_prior_games
                w = n["n"] / (n["n"] + k)
                minutes = w * float(n["min_ewm"]) + (1 - w) * ref_minutes
        elif ref_minutes is not None:
            rate, minutes = ref_rate, ref_minutes
        else:
            out.append((np.nan, np.nan, np.nan, np.nan, np.nan))
            continue

        opp_f = 1.0
        if pos and params.opponent_weight:
            idx = opp.get((str(row.opponent_code), pos))
            if idx is not None:
                opp_f = 1.0 + params.opponent_weight * (idx - 1.0)
        home = home_f if bool(row.is_home) else away_f
        projection = minutes * rate * opp_f * home
        out.append((projection, minutes, rate, opp_f, home))

    frame = pd.DataFrame(out, columns=["projection", "minutes", "rate", "opp", "home"], index=targets.index)
    return frame


# ---------------------------------------------------------------------------
# Horquillas
# ---------------------------------------------------------------------------
def residual_bands(rows: pd.DataFrame, *, bins: int = BAND_BINS, min_rows: int = BAND_MIN_ROWS) -> list[dict[str, float]]:
    """Cuánto se aleja lo real de lo proyectado, por nivel de proyección.

    `rows` son las filas de `backtest_rows` (`v2` proyectado si juega, `y` real).
    Se parten en tramos con el mismo número de partidos y en cada uno se miden
    los percentiles 10, 25, 75 y 90 del error (real − proyectado). La dispersión
    crece con la proyección (5,6 puntos de desviación en quien proyecta menos de
    5; 9,2 en quien pasa de 12), así que una sola horquilla para todos se queda
    ancha abajo y corta arriba.

    Devuelve una fila por tramo, con su proyección central; lista vacía si no
    hay muestra.
    """
    if rows is None or rows.empty or not {"v2", "y"} <= set(rows.columns):
        return []
    data = rows.dropna(subset=["v2", "y"])
    if len(data) < min_rows:
        return []
    cuts = pd.qcut(data["v2"], bins, duplicates="drop")
    out: list[dict[str, float]] = []
    for _, part in data.groupby(cuts, observed=True):
        residual = part["y"] - part["v2"]
        out.append({
            "center": round(float(part["v2"].median()), 2),
            "n": int(len(part)),
            **{f"p{int(q * 100)}": round(float(residual.quantile(q)), 2) for q in BAND_QUANTILES},
        })
    return out


def _band_arrays(bands: list[dict[str, float]], projection: Any) -> dict[str, np.ndarray]:
    """p10, p25, p75 y p90 del error para una o varias proyecciones.

    Entre tramos, interpolación lineal. Fuera de ellos la horquilla sigue
    creciendo (o encogiendo) con la raíz de la proyección, que es como crece
    la dispersión de una suma de aciertos: el último tramo se centra en unos 14
    puntos y los candidatos a capitán proyectan 20 o más. Dejándola plana, en la
    prueba hacia delante recogía el 41 % de sus resultados y el 16 % pasaba del
    p90; así, el 45 % y el 14 %.
    """
    value = np.asarray(projection, dtype=float)
    centers = np.array([band["center"] for band in bands], dtype=float)
    low, high = max(centers[0], 1e-9), max(centers[-1], 1e-9)
    scale = np.ones_like(value)
    scale = np.where(value > high, np.sqrt(np.maximum(value, 0.0) / high), scale)
    scale = np.where(value < low, np.sqrt(np.maximum(value, 0.5) / low), scale)
    return {
        key: np.interp(value, centers, [band[key] for band in bands]) * scale
        for key in ("p10", "p25", "p75", "p90")
    }


def band_offsets(bands: list[dict[str, float]] | None, projection: float) -> dict[str, float] | None:
    """Lo que hay que sumar a una proyección para tener su p10, p25, p75 y p90."""
    if not bands:
        return None
    return {key: float(value) for key, value in _band_arrays(bands, projection).items()}


def band_check(rows: pd.DataFrame) -> dict[str, float] | None:
    """Las horquillas, puestas a prueba hacia delante: para cada jornada se
    calculan solo con las anteriores y se mira cuántos resultados caen dentro.
    Tendría que ser la mitad entre p25 y p75 y uno de cada diez por encima del
    p90."""
    if rows is None or rows.empty:
        return None
    data = rows.dropna(subset=["v2", "y"])
    inside = above = total = 0
    for number in sorted(data["round"].unique()):
        bands = residual_bands(data[data["round"] < number])
        test = data[data["round"] == number]
        if not bands or test.empty:
            continue
        residual = (test["y"] - test["v2"]).to_numpy()
        offsets = _band_arrays(bands, test["v2"].to_numpy())
        inside += int(((residual >= offsets["p25"]) & (residual <= offsets["p75"])).sum())
        above += int((residual > offsets["p90"]).sum())
        total += len(test)
    if not total:
        return None
    return {"n": total, "inside": round(inside / total, 3), "aboveP90": round(above / total, 3)}


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------
def _legacy_projection(history: pd.DataFrame, targets: pd.DataFrame) -> pd.Series:
    """El modelo de antes (metrics.project_fantasy_points) sobre el mismo historial."""
    from efa.metrics import player_performance, project_fantasy_points

    perf = player_performance(history)
    table = targets[["person_code"]].merge(perf, on="person_code", how="left")
    table["fpt"] = np.nan
    return pd.Series(project_fantasy_points(table, baseline=False).to_numpy(), index=targets.index).where(
        table["games_played"].fillna(0).to_numpy() > 0
    )


def backtest_rows(
    gamelog: pd.DataFrame,
    positions: dict[str, str],
    prior: pd.DataFrame | None = None,
    params: Params = PARAMS,
    *,
    cache: dict[Any, pd.Series] | None = None,
    references: Callable[[int, pd.DataFrame], dict[str, dict[str, float]]] | None = None,
) -> pd.DataFrame:
    """Una fila por partido jugado, predicho solo con los anteriores (por
    jornada): `round`, `y` (lo real), `v2`, `legacy`, `mean`, `prior_mean` y
    `games` (partidos jugados antes). Es la materia prima de `backtest()` y de
    las horquillas (`residual_bands`)."""
    log_sorted = gamelog.sort_values(["utc_date", "game_code"])
    prior_mean = (
        prior[prior["played"]].groupby("person_code")["fantasy_points"].mean()
        if prior is not None and not prior.empty
        else pd.Series(dtype=float)
    )
    rounds = [r for r in sorted(log_sorted["round"].dropna().unique())]
    rows = []
    for r in rounds:
        in_round = log_sorted[log_sorted["round"] == r]
        start = in_round["utc_date"].min()
        history = log_sorted[log_sorted["utc_date"] < start]
        targets = in_round[in_round["played"]]
        if targets.empty:
            continue
        implied = references(int(r), history) if references else None
        v2 = project(targets, history, prior, positions, params, implied_prior=implied)
        # El modelo de antes no depende de `params`: se calcula una vez por jornada.
        if cache is not None and r in cache:
            legacy = cache[r]
        else:
            legacy = _legacy_projection(history, targets) if not history.empty else pd.Series(np.nan, index=targets.index)
            if cache is not None:
                cache[r] = legacy
        games = history[history["played"]].groupby("person_code").size()
        mean = history[history["played"]].groupby("person_code")["fantasy_points"].mean()
        frame = pd.DataFrame({
            "round": r,
            "y": targets["fantasy_points"].to_numpy(),
            "v2": v2["projection"].to_numpy(),
            "legacy": legacy.to_numpy(),
            "mean": targets["person_code"].map(mean).to_numpy(),
            "prior_mean": targets["person_code"].map(prior_mean).to_numpy(),
            "games": targets["person_code"].map(games).fillna(0).to_numpy(),
        })
        rows.append(frame)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def backtest(
    gamelog: pd.DataFrame,
    positions: dict[str, str],
    prior: pd.DataFrame | None = None,
    params: Params = PARAMS,
    *,
    min_games: int = 1,
    cache: dict[Any, pd.Series] | None = None,
    references: Callable[[int, pd.DataFrame], dict[str, dict[str, float]]] | None = None,
    from_round: int | None = None,
) -> dict[str, Any]:
    """Predice cada partido de `gamelog` solo con los anteriores (por jornada).

    Devuelve el error medio del modelo v2, del de antes y de la media simple
    sobre los mismos partidos: los del jugador con `min_games` o más jugados.
    `references(jornada, historial)` da la referencia de cada jugador con lo que
    se sabía antes de esa jornada (ver `price_references`). Con `from_round`
    solo se puntúan las jornadas desde esa (el historial sigue siendo todo).
    """
    data = backtest_rows(gamelog, positions, prior, params, cache=cache, references=references)
    if data.empty:
        return {"n": 0}
    data = data[data["games"] >= min_games]
    every_round = data
    if from_round is not None:
        data = data[data["round"] >= from_round]
        if data.empty:
            return {"n": 0}
    # Se comparan los modelos que tienen predicción en al menos la mitad de los
    # partidos, sobre los partidos en los que TODOS la tienen.
    models = [c for c in ("v2", "legacy", "mean", "prior_mean") if data[c].notna().mean() >= 0.5]
    common = data.dropna(subset=models)
    if common.empty:
        return {"n": 0}

    def score(col: str, frame: pd.DataFrame) -> dict[str, float]:
        err = frame[col] - frame["y"]
        return {"mae": round(float(err.abs().mean()), 3), "rmse": round(float(np.sqrt((err ** 2).mean())), 3),
                "bias": round(float(err.mean()), 3)}

    result: dict[str, Any] = {"n": int(len(common)), "rounds": int(common["round"].nunique())}
    for col in models:
        result[col] = score(col, common)
    buckets = {}
    for lo, hi in ((1, 3), (4, 8), (9, 99)):
        part = common[(common["games"] >= lo) & (common["games"] <= hi)]
        if len(part):
            buckets[f"{lo}-{hi}"] = {"n": int(len(part)), **{c: score(c, part)["mae"] for c in models}}
    result["byGames"] = buckets
    # Calibración de la horquilla: residuos relativos para cuantiles empíricos.
    resid = (common["y"] - common["v2"]).to_numpy()
    result["residualQuantiles"] = {
        q: round(float(np.quantile(resid, q)), 2) for q in (0.1, 0.25, 0.5, 0.75, 0.9)
    }
    # Horquillas por nivel de proyección, con todas las jornadas, y su prueba
    # hacia delante.
    result["bands"] = residual_bands(every_round)
    check = band_check(every_round)
    if check:
        result["bandCheck"] = check
    return result


# ---------------------------------------------------------------------------
# Producción: la próxima jornada de cada jugador del mercado
# ---------------------------------------------------------------------------
def next_games(games: list[dict[str, Any]], round_now: int) -> dict[str, dict[str, Any]]:
    """club -> su primer partido SIN JUGAR desde la jornada `round_now`.

    Con la jornada a medias, quien ya jugó la suya pasa a la siguiente: antes se
    le seguía proyectando (y enseñando como "próximo") el partido ya jugado.
    """
    from efa.fixtures import pending_games

    out: dict[str, dict[str, Any]] = {}
    # Sin los aplazados: un partido sin jugar con la fecha ya pasada no es "el
    # próximo" de nadie.
    for game in pending_games(games):
        if int(game.get("round") or 0) < round_now:
            continue
        for side in ("local", "road"):
            club = ((game.get(side) or {}).get("club") or {}).get("code")
            if club and str(club) not in out:
                out[str(club)] = game
    return out


def next_fixtures(games: list[dict[str, Any]], round_now: int) -> dict[str, tuple[str, bool]]:
    """club -> (rival, juega en casa) en su próximo partido sin jugar."""
    out: dict[str, tuple[str, bool]] = {}
    for club, game in next_games(games, round_now).items():
        local = ((game.get("local") or {}).get("club") or {}).get("code")
        road = ((game.get("road") or {}).get("club") or {}).get("code")
        if local and road:
            out[club] = (str(road), True) if str(local) == club else (str(local), False)
    return out


def implied_priors(table: pd.DataFrame, prior: pd.DataFrame | None) -> dict[str, dict[str, float]]:
    """Minutos y producción por minuto que "descuenta" el precio, para quien no
    tiene año pasado: rectas precio -> minutos y precio -> puntos/minuto
    ajustadas con los que sí lo tienen."""
    if prior is None or prior.empty or "quotation" not in table.columns:
        return {}
    state = player_state(prior, PARAMS.minutes_half_life)
    state = state[state["min_sum"] >= 100]
    frame = table[["person_code", "quotation"]].dropna()
    frame = frame[frame["quotation"] > 0]
    known = frame[frame["person_code"].isin(state.index)]
    if len(known) < 30:
        return {}
    x = known["quotation"].to_numpy(dtype=float)
    minutes = state.loc[known["person_code"], "min_avg"].to_numpy(dtype=float)
    rate = (state.loc[known["person_code"], "fp_sum"] / state.loc[known["person_code"], "min_sum"]).to_numpy(dtype=float)
    fit_m = np.polyfit(x, minutes, 1)
    fit_r = np.polyfit(x, rate, 1)
    out: dict[str, dict[str, float]] = {}
    for code, price in frame[~frame["person_code"].isin(state.index)].itertuples(index=False):
        out[str(code)] = {
            "minutes": float(np.clip(np.polyval(fit_m, price), 5.0, 32.0)),
            "rate": float(np.clip(np.polyval(fit_r, price), 0.3, 1.4)),
        }
    return out


def price_references(
    table: pd.DataFrame,
    history: pd.DataFrame,
    positions: dict[str, str],
    params: Params = PARAMS,
) -> dict[str, dict[str, float]]:
    """Referencia de cada jugador con datos de ESTA temporada, sin la anterior.

    Rectas precio -> minutos y precio -> puntos/minuto ajustadas con quien ya ha
    jugado `PRICE_FIT_MIN_MINUTES`. La producción de referencia mezcla la que
    descuenta su precio con la de su puesto: solo el precio sobreestimaba a los
    caros y solo el puesto los infravaloraba. Reconstruyendo lo publicado en
    J4–J10 con el 75 % de precio, el sesgo de los de 13+ créditos es +0,11 (+0,39
    con la temporada anterior) y el error medio de J7–J10, 4,50 (4,52).
    """
    if history is None or history.empty or "quotation" not in table.columns:
        return {}
    state = player_state(history, params.minutes_half_life)
    state = state[state["min_sum"] >= PRICE_FIT_MIN_MINUTES]
    frame = table[["person_code", "quotation"]].dropna().drop_duplicates("person_code")
    frame = frame[frame["quotation"] > 0].assign(person_code=lambda f: f["person_code"].astype(str))
    known = frame[frame["person_code"].isin(state.index)]
    if len(known) < 30:
        return {}
    x = known["quotation"].to_numpy(dtype=float)
    codes = known["person_code"]
    fit_m = np.polyfit(x, state.loc[codes, "min_avg"].to_numpy(dtype=float), 1)
    fit_r = np.polyfit(x, (state.loc[codes, "fp_sum"] / state.loc[codes, "min_sum"]).to_numpy(dtype=float), 1)
    rates = position_rates(history, positions)
    league = rates.get("all", 0.5)
    out: dict[str, dict[str, float]] = {}
    for code, price in frame.itertuples(index=False):
        by_price = float(np.clip(np.polyval(fit_r, price), 0.3, 1.4))
        by_position = rates.get(positions.get(code) or "all", league)
        out[code] = {
            "minutes": float(np.clip(np.polyval(fit_m, price), 5.0, 32.0)),
            "rate": PRICE_RATE_WEIGHT * by_price + (1 - PRICE_RATE_WEIGHT) * by_position,
        }
    return out


def production_projection(
    table: pd.DataFrame,
    history: pd.DataFrame,
    prior: pd.DataFrame | None,
    games: list[dict[str, Any]],
    round_now: int,
    positions: dict[str, str],
    params: Params = PARAMS,
) -> pd.DataFrame:
    """Proyección v2 (si juega) de cada jugador de `table` para `round_now`.

    `table` necesita `person_code`, `club_code` y `quotation`. Devuelve una fila
    por person_code con `v2_projection`, `v2_minutes`, `v2_rate`, `v2_opp` y
    `v2_home`.
    """
    fixtures = next_fixtures(games, round_now)
    rows = table[["person_code", "club_code"]].dropna().drop_duplicates("person_code")
    rows = rows.assign(
        opponent_code=rows["club_code"].map(lambda c: fixtures.get(str(c), (None, True))[0]),
        is_home=rows["club_code"].map(lambda c: fixtures.get(str(c), (None, True))[1]),
    )
    has_prior = prior is not None and not prior.empty
    implied = implied_priors(table, prior) if has_prior else price_references(table, history, positions, params)
    result = project(rows, history, prior, positions, params, implied_prior=implied)
    out = pd.DataFrame({
        "person_code": rows["person_code"].astype(str).to_numpy(),
        "v2_projection": result["projection"].round(2).to_numpy(),
        "v2_minutes": result["minutes"].round(1).to_numpy(),
        "v2_rate": result["rate"].round(3).to_numpy(),
        "v2_opp": result["opp"].round(3).to_numpy(),
        "v2_home": result["home"].round(3).to_numpy(),
    })
    return out


def market_before_round(
    snapshots: pd.DataFrame,
    crosswalk: pd.DataFrame,
    games: list[dict[str, Any]],
    round_number: int,
) -> pd.DataFrame:
    """Mercado (`person_code`, `club_code`, `position`, `quotation`) justo antes
    del primer partido de la jornada: lo que se sabía al proyectarla."""
    empty = pd.DataFrame(columns=["person_code", "club_code", "position", "quotation"])
    times = [
        pd.to_datetime(g["utcDate"], utc=True)
        for g in games
        if int(g.get("round") or 0) == round_number and g.get("utcDate")
    ]
    if snapshots.empty or crosswalk.empty or not times:
        return empty
    stamps = pd.to_datetime(snapshots["captured_at"], utc=True)
    before = stamps[stamps < min(times)]
    if before.empty:
        return empty
    snap = snapshots[stamps == before.max()].merge(
        crosswalk[["fantaking_id", "person_code", "club_code"]], on="fantaking_id"
    )
    return snap[["person_code", "club_code", "position", "quotation"]]


def _honesty_checks(log_now, positions, references, replace) -> dict[str, Any]:
    """Dos cosas que el backtest tiene que decir de sí mismo.

    `ablation`: el error medio quitando cada pieza. Rival, cancha y minutos
    recientes se enseñan en la ficha; si no bajan el error, hay que saberlo
    (J2–J10 de la 2026-27: 6,02 con todo y 6,03 sin rival ni cancha).

    `afterFreeze`: el error solo en las jornadas posteriores a la última vez
    que se tocó un parámetro (ver PARAMS_FROZEN_ROUND). Es el único tramo en el
    que el modelo no ha visto antes lo que predice.
    """
    cache: dict[Any, pd.Series] = {}
    variants = {
        "noOpponent": replace(PARAMS, opponent_weight=0.0),
        "noHome": replace(PARAMS, use_home=False),
        "plain": replace(PARAMS, opponent_weight=0.0, use_home=False),
        "seasonMinutes": replace(PARAMS, minutes_half_life=50.0),
    }
    ablation: dict[str, float] = {}
    for name, params in variants.items():
        result = backtest(log_now, positions, params=params, min_games=0, references=references, cache=cache)
        if result.get("v2"):
            ablation[name] = result["v2"]["mae"]
    out: dict[str, Any] = {"ablation": ablation, "frozenFromRound": PARAMS_FROZEN_ROUND}
    after = backtest(
        log_now, positions, min_games=0, references=references, cache=cache, from_round=PARAMS_FROZEN_ROUND
    )
    if after.get("n"):
        out["afterFreeze"] = {key: after[key] for key in ("n", "rounds", "v2", "mean") if key in after}
    return out


def run_backtests() -> dict[str, Any]:
    """Los backtests que publica la web: temporada en curso y modelo del
    entrenador. Mientras la temporada anterior aún cuenta (ver
    PRIOR_SEASON_ROUNDS), también ella entera, como única muestra amplia."""
    from dataclasses import asdict, replace
    from datetime import datetime, timezone

    from efa import matchmodel
    from efa.config import CROSSWALK_PATH, PRIOR_SEASON_CODE, SEASON_CODE, use_prior_season
    from efa.context import player_positions, season_gamelog
    from efa.ingest.official import load_reference
    from efa.ingest.prices import load_snapshots

    ref_prior, ref_now = load_reference(PRIOR_SEASON_CODE), load_reference(SEASON_CODE)
    # La de esta temporada manda (por eso va primero).
    positions = player_positions([ref_now, ref_prior])
    log_now = season_gamelog(SEASON_CODE)
    use_prior = use_prior_season(int(log_now["round"].nunique()) if not log_now.empty else 0)
    log_prior = season_gamelog(PRIOR_SEASON_CODE) if use_prior else pd.DataFrame()

    games_now = ref_now.get("games", [])
    snapshots = load_snapshots()
    crosswalk = (
        pd.read_csv(CROSSWALK_PATH, dtype={"person_code": str})
        if CROSSWALK_PATH.exists()
        else pd.DataFrame(columns=["fantaking_id", "person_code", "club_code"])
    )

    def references(round_number: int, history: pd.DataFrame) -> dict[str, dict[str, float]]:
        return price_references(market_before_round(snapshots, crosswalk, games_now, round_number), history, positions)

    def values_for_round(round_number: int) -> dict[str, float]:
        return matchmodel.roster_values(market_before_round(snapshots, crosswalk, games_now, round_number))

    out: dict[str, Any] = {"generatedAt": datetime.now(timezone.utc).isoformat(), "params": asdict(PARAMS)}
    if not log_prior.empty:
        season = backtest(log_prior[log_prior["phase"] == "RS"], positions)
        rmse = season.get("v2", {}).get("rmse") or 1.0
        season["zQuantiles"] = {
            f"p{int(q * 100)}": round(v / rmse, 3) for q, v in season.get("residualQuantiles", {}).items()
        }
        out["season"] = {"code": PRIOR_SEASON_CODE, **season}
    if not log_now.empty and log_now["played"].any():
        current = (
            backtest(log_now, positions, prior=log_prior, min_games=0)
            if use_prior
            else backtest(log_now, positions, min_games=0, references=references)
        )
        rmse = current.get("v2", {}).get("rmse") or 1.0
        current["zQuantiles"] = {
            f"p{int(q * 100)}": round(v / rmse, 3) for q, v in current.get("residualQuantiles", {}).items()
        }
        if not use_prior and current.get("n"):
            current.update(_honesty_checks(log_now, positions, references, replace))
        out["current"] = {"code": SEASON_CODE, **current}
    # Lo que la web publicó antes de cada jornada, frente a lo que pasó.
    from efa.context import season_boxscores
    from efa.gamelogs import build_coach_gamelog
    from efa.published import evaluate_published

    coach_log = build_coach_gamelog(season_boxscores(SEASON_CODE), games_now)
    published = evaluate_published(log_now, games_now, snapshots, coach_log)
    if published:
        out["published"] = published
    out["coach"] = (
        {
            "code": PRIOR_SEASON_CODE,
            **matchmodel.backtest([g for g in ref_prior.get("games", []) if (g.get("phaseType") or {}).get("code") == "RS"]),
        }
        if use_prior
        else {"code": SEASON_CODE, **matchmodel.backtest(games_now, values_for_round=values_for_round)}
    )
    return out
