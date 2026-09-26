"""Proyección v2: minutos esperados × producción por minuto × rival × cancha.

La proyección de antes era una media de puntos con retoques (forma, tendencia
de minutos). Esta separa las dos cosas que se mueven a ritmos distintos:

  - los MINUTOS cambian rápido (rol, rotación, lesiones de compañeros): media
    exponencial de los últimos partidos, encogida hacia los del año pasado;
  - la PRODUCCIÓN POR MINUTO es estable: suma de puntos entre suma de minutos,
    encogida hacia la del año pasado (o la de su puesto) con un colchón en
    minutos, no en partidos.

Encima, dos ajustes de contexto medidos en los propios datos:

  - RIVAL: lo que concede cada club a cada puesto frente a la media de la
    liga, encogido según los partidos que lleva;
  - CANCHA: el factor local/visitante de toda la liga.

`backtest()` predice cada partido de una temporada solo con los anteriores y
compara con el modelo de antes. Los parámetros de `PARAMS` salen de ahí: una
rejilla de 27 combinaciones sobre la 2025-26 (7.924 partidos) dio el mejor
error medio con el rival al 50 %, 100 min de colchón y vida media de 3
partidos: 5,945 frente a 6,072 del modelo de antes y 6,098 de la media.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Params:
    #: Colchón de la producción por minuto, en minutos jugados: con 100 min
    #: (unos cuatro partidos) pesa a medias lo de ahora y la referencia.
    rate_prior_minutes: float = 100.0
    #: Vida media, en partidos, de la media exponencial de minutos.
    minutes_half_life: float = 3.0
    #: Colchón de los minutos, en partidos, hacia los del año pasado.
    minutes_prior_games: float = 2.0
    #: Colchón del factor rival, en partidos del rival.
    opponent_prior_games: float = 8.0
    #: Cuánto del factor rival se aplica (0 = nada, 1 = entero).
    opponent_weight: float = 0.5
    #: Aplicar el factor cancha medido.
    use_home: bool = True


PARAMS = Params()


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
    rates = position_rates(history, positions) if len(history) > 2000 else {}
    if prior is not None and not prior.empty:
        prior_rates = position_rates(prior, positions)
        # Con poca temporada, las medias de puesto también salen del año pasado.
        rates = {**prior_rates, **rates} if rates else prior_rates
    opp = opponent_index(pd.concat([prior, history]) if prior is not None else history, positions,
                         params.opponent_prior_games)
    home_f, away_f = home_factor(pd.concat([prior, history]) if prior is not None else history) if params.use_home else (1.0, 1.0)
    league_rate = rates.get("all", 0.5)

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

        n = now.loc[code] if code in now.index else None
        if n is not None:
            m0 = params.rate_prior_minutes
            rate = (n["fp_sum"] + m0 * ref_rate) / (n["min_sum"] + m0)
            if ref_minutes is None:
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


def backtest(
    gamelog: pd.DataFrame,
    positions: dict[str, str],
    prior: pd.DataFrame | None = None,
    params: Params = PARAMS,
    *,
    min_games: int = 1,
    cache: dict[Any, pd.Series] | None = None,
) -> dict[str, Any]:
    """Predice cada partido de `gamelog` solo con los anteriores (por jornada).

    Devuelve el error medio del modelo v2, del de antes y de la media simple
    sobre los mismos partidos: los del jugador con `min_games` o más jugados.
    """
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
        v2 = project(targets, history, prior, positions, params)
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
    data = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    if data.empty:
        return {"n": 0}
    data = data[data["games"] >= min_games]
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
    return result


# ---------------------------------------------------------------------------
# Producción: la próxima jornada de cada jugador del mercado
# ---------------------------------------------------------------------------
def next_fixtures(games: list[dict[str, Any]], round_now: int) -> dict[str, tuple[str, bool]]:
    """club -> (rival, juega en casa) en la jornada `round_now`."""
    out: dict[str, tuple[str, bool]] = {}
    for game in games:
        if int(game.get("round") or 0) != round_now:
            continue
        local = ((game.get("local") or {}).get("club") or {}).get("code")
        road = ((game.get("road") or {}).get("club") or {}).get("code")
        if local and road:
            out[str(local)] = (str(road), True)
            out[str(road)] = (str(local), False)
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
    result = project(rows, history, prior, positions, params, implied_prior=implied_priors(table, prior))
    out = pd.DataFrame({
        "person_code": rows["person_code"].astype(str).to_numpy(),
        "v2_projection": result["projection"].round(2).to_numpy(),
        "v2_minutes": result["minutes"].round(1).to_numpy(),
        "v2_rate": result["rate"].round(3).to_numpy(),
        "v2_opp": result["opp"].round(3).to_numpy(),
        "v2_home": result["home"].round(3).to_numpy(),
    })
    return out


def run_backtests() -> dict[str, Any]:
    """Los backtests que publica la web: temporada anterior entera, temporada en
    curso (con la anterior de referencia) y el modelo del entrenador."""
    from dataclasses import asdict
    from datetime import datetime, timezone

    from efa import matchmodel
    from efa.config import PRIOR_SEASON_CODE, SEASON_CODE
    from efa.gamelogs import build_gamelog
    from efa.ingest.official import load_boxscores, load_reference
    from efa.optimizer import normalize_position

    ref_prior, ref_now = load_reference(PRIOR_SEASON_CODE), load_reference(SEASON_CODE)
    positions: dict[str, str] = {}
    for ref in (ref_prior, ref_now):
        for entry in ref.get("players", []):
            pos = normalize_position(entry.get("positionName"))
            code = str((entry.get("person") or {}).get("code") or "")
            if pos and code:
                positions[code] = pos
    log_prior = build_gamelog(load_boxscores(PRIOR_SEASON_CODE), ref_prior.get("games", []))
    log_now = build_gamelog(load_boxscores(SEASON_CODE), ref_now.get("games", []))

    out: dict[str, Any] = {"generatedAt": datetime.now(timezone.utc).isoformat(), "params": asdict(PARAMS)}
    if not log_prior.empty:
        season = backtest(log_prior[log_prior["phase"] == "RS"], positions)
        rmse = season.get("v2", {}).get("rmse") or 1.0
        season["zQuantiles"] = {
            f"p{int(q * 100)}": round(v / rmse, 3) for q, v in season.get("residualQuantiles", {}).items()
        }
        out["season"] = {"code": PRIOR_SEASON_CODE, **season}
    if not log_now.empty and log_now["played"].any():
        out["current"] = {"code": SEASON_CODE, **backtest(log_now, positions, prior=log_prior, min_games=0)}
    out["coach"] = {
        "code": PRIOR_SEASON_CODE,
        **matchmodel.backtest([g for g in ref_prior.get("games", []) if (g.get("phaseType") or {}).get("code") == "RS"]),
    }
    return out
