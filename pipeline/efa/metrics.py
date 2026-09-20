"""Capa de métricas: de datos crudos a señales de decisión.

Todo lo que hay aquí responde a una pregunta concreta que uno se hace antes de
fichar:

  ¿cuánto rinde por crédito?          -> value_per_credit, value_form
  ¿es fiable o una lotería?           -> fp_std, floor, ceiling, consistency
  ¿está subiendo o bajando de forma?  -> form, form_delta
  ¿está ganando o perdiendo rol?      -> minutes_trend, minutes_share_trend
  ¿va a subir de precio?              -> price_pressure
  ¿tiene buen calendario?             -> schedule_difficulty
"""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd

from efa.config import FORM_WINDOW, MIN_GAMES_FOR_TREND

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rendimiento del jugador
# ---------------------------------------------------------------------------
def _mean(frame: pd.DataFrame, column: str) -> float:
    """Media de una columna del game log sobre los partidos jugados.

    Devuelve 0.0 si la columna no existe: un game log antiguo no debe romper el
    build, solo quedarse sin esa media.
    """
    if frame.empty or column not in frame:
        return 0.0
    return round(float(frame[column].mean()), 1)


def player_performance(gamelog: pd.DataFrame, *, window: int = FORM_WINDOW) -> pd.DataFrame:
    """Agregados por jugador a partir del game log.

    Los partidos sin minutos (DNP) se excluyen de las medias de rendimiento
    pero se cuentan aparte: un jugador que no juega es una señal, no un cero.
    """
    if gamelog.empty:
        return pd.DataFrame(
            columns=[
                "person_code", "games", "games_played", "dnp_rate", "started_rate",
                "minutes_avg", "minutes_recent", "minutes_trend",
                "fp_avg", "fp_median", "fp_std", "fp_floor", "fp_ceiling",
                "fp_per_min", "consistency", "form", "form_delta", "last_fp",
                "pts_avg", "reb_avg", "ast_avg", "pir_avg", "plus_minus_avg",
            ]
        )

    log_sorted = gamelog.sort_values(["person_code", "round", "game_code"])

    def aggregate(person: str, group: pd.DataFrame) -> dict[str, Any]:
        active = group[group["played"]]
        n_active = len(active)

        fp = active["fantasy_points"]
        minutes = active["minutes"]
        recent = active.tail(window)
        earlier = active.iloc[:-window] if n_active > window else active.head(0)

        fp_avg = float(fp.mean()) if n_active else 0.0
        fp_std = float(fp.std(ddof=0)) if n_active > 1 else 0.0
        form = float(recent["fantasy_points"].mean()) if len(recent) else 0.0

        minutes_avg = float(minutes.mean()) if n_active else 0.0
        minutes_recent = float(recent["minutes"].mean()) if len(recent) else 0.0
        minutes_prior = float(earlier["minutes"].mean()) if len(earlier) else minutes_avg

        # Coeficiente de variación invertido y acotado: 1 = metronomo, 0 = lotería.
        consistency = 0.0
        if n_active >= 2 and fp_avg > 0:
            consistency = float(np.clip(1 - (fp_std / fp_avg), 0, 1))

        share_recent = float(recent["minutes_share"].mean()) if "minutes_share" in group and len(recent) else 0.0
        share_prior = (
            float(earlier["minutes_share"].mean())
            if "minutes_share" in group and len(earlier)
            else share_recent
        )

        return (
            {
                "person_code": person,
                "games": int(len(group)),
                "games_played": n_active,
                "dnp_rate": round(1 - n_active / len(group), 3) if len(group) else 0.0,
                "started_rate": round(float(active["started"].mean()), 3) if n_active else 0.0,
                "minutes_avg": round(minutes_avg, 1),
                "minutes_recent": round(minutes_recent, 1),
                "minutes_trend": round(minutes_recent - minutes_prior, 1) if n_active >= MIN_GAMES_FOR_TREND else 0.0,
                "minutes_share_recent": round(share_recent, 4),
                "minutes_share_trend": round(share_recent - share_prior, 4),
                "fp_avg": round(fp_avg, 2),
                "fp_median": round(float(fp.median()), 2) if n_active else 0.0,
                "fp_std": round(fp_std, 2),
                "fp_floor": round(float(fp.quantile(0.25)), 2) if n_active >= 2 else round(fp_avg, 2),
                "fp_ceiling": round(float(fp.quantile(0.75)), 2) if n_active >= 2 else round(fp_avg, 2),
                "fp_per_min": round(fp_avg / minutes_avg, 3) if minutes_avg > 0 else 0.0,
                "consistency": round(consistency, 3),
                "form": round(form, 2),
                "form_delta": round(form - fp_avg, 2) if n_active >= MIN_GAMES_FOR_TREND else 0.0,
                "last_fp": round(float(fp.iloc[-1]), 2) if n_active else 0.0,
                # Medias de caja. El game log ya las trae por partido desde el
                # principio; lo único que faltaba era promediarlas.
                "pts_avg": _mean(active, "points"),
                "reb_avg": _mean(active, "rebounds"),
                "ast_avg": _mean(active, "assists"),
                "pir_avg": _mean(active, "valuation"),
                "plus_minus_avg": _mean(active, "plus_minus"),
            }
        )

    rows = [aggregate(str(person), group) for person, group in log_sorted.groupby("person_code", sort=False)]
    return pd.DataFrame(rows)


def recent_series(gamelog: pd.DataFrame, *, limit: int = 12) -> dict[str, list[dict[str, Any]]]:
    """Serie de últimas actuaciones por jugador, para las sparklines del front."""
    if gamelog.empty:
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    ordered = gamelog.sort_values(["round", "game_code"])
    for person, group in ordered.groupby("person_code"):
        tail = group.tail(limit)
        out[str(person)] = [
            {
                "round": int(row["round"]) if pd.notna(row["round"]) else None,
                "opponent": row["opponent_code"],
                "home": bool(row["is_home"]),
                "minutes": float(row["minutes"]),
                "fp": float(row["fantasy_points"]),
                "played": bool(row["played"]),
            }
            for _, row in tail.iterrows()
        ]
    return out


# ---------------------------------------------------------------------------
# Precios
# ---------------------------------------------------------------------------
def price_history(snapshots: pd.DataFrame) -> pd.DataFrame:
    """Evolución del precio por jugador a lo largo de los snapshots."""
    empty_cols = [
        "fantaking_id", "quotation", "quotation_open", "price_delta_last",
        "price_delta_total", "price_points", "snapshots",
    ]
    if snapshots.empty or "quotation" not in snapshots.columns:
        return pd.DataFrame(columns=empty_cols)

    rows: list[dict[str, Any]] = []
    for pid, group in snapshots.sort_values("captured_at").groupby("fantaking_id"):
        quotes = group["quotation"].astype(float).tolist()
        stamps = group["captured_at"].tolist()
        rows.append(
            {
                "fantaking_id": pid,
                "quotation": quotes[-1],
                "quotation_open": quotes[0],
                "price_delta_last": round(quotes[-1] - quotes[-2], 2) if len(quotes) > 1 else 0.0,
                "price_delta_total": round(quotes[-1] - quotes[0], 2),
                "price_points": [
                    {"t": stamp.isoformat(), "q": round(float(q), 2)}
                    for stamp, q in zip(stamps, quotes, strict=False)
                ],
                "snapshots": len(quotes),
            }
        )
    return pd.DataFrame(rows)


def price_pressure(table: pd.DataFrame) -> pd.Series:
    """Cuánto rinde un jugador por encima de lo que su precio implica.

    Las reglas dicen que la revalorización depende del score obtenido y del
    precio de partida: a igual score, sube más quien parte de un precio bajo.
    Así que se ajusta una curva fp ~ precio sobre el mercado entero y se mira el
    residuo. Residuo positivo grande = candidato a subir.

    No es la fórmula real de Fantaking (no es pública), es un proxy: mide
    sobre-rendimiento relativo a la banda de precio, que es exactamente lo que
    la regla describe.
    """
    quotation = pd.to_numeric(table.get("quotation"), errors="coerce")
    reference = pd.to_numeric(table.get("form"), errors="coerce")
    reference = reference.where(reference.notna() & (reference != 0), pd.to_numeric(table.get("fp_avg"), errors="coerce"))

    mask = quotation.notna() & reference.notna() & (quotation > 0)
    result = pd.Series(np.nan, index=table.index, dtype=float)
    if mask.sum() < 8:
        return result

    x = quotation[mask].to_numpy(dtype=float)
    y = reference[mask].to_numpy(dtype=float)
    # Cuadrática: la relación precio-rendimiento se aplana en la banda alta.
    coefficients = np.polyfit(x, y, 2)
    expected = np.polyval(coefficients, x)
    residual = y - expected
    spread = residual.std()
    result.loc[mask] = residual / spread if spread > 0 else 0.0
    return result.round(2)


# ---------------------------------------------------------------------------
# Equipos y calendario
# ---------------------------------------------------------------------------
def team_strength(games: list[dict[str, Any]], *, prior: pd.DataFrame | None = None) -> pd.DataFrame:
    """Rating ofensivo/defensivo por club a partir de los resultados.

    Si la temporada aún no ha empezado (sin partidos jugados), se usa el rating
    de la temporada anterior como prior, para que el módulo de calendario tenga
    algo que decir desde la jornada 1.
    """
    rows: list[dict[str, Any]] = []
    for game in games:
        if not game.get("played"):
            continue
        local = ((game.get("local") or {}).get("club") or {}).get("code")
        road = ((game.get("road") or {}).get("club") or {}).get("code")
        local_score = float((game.get("local") or {}).get("score") or 0)
        road_score = float((game.get("road") or {}).get("score") or 0)
        if not local or not road:
            continue
        rows.append({"club_code": local, "scored": local_score, "conceded": road_score, "won": local_score > road_score})
        rows.append({"club_code": road, "scored": road_score, "conceded": local_score, "won": road_score > local_score})

    if not rows:
        if prior is not None and not prior.empty:
            out = prior.copy()
            out["source"] = "temporada anterior"
            return out
        return pd.DataFrame(columns=["club_code", "offense", "defense", "net_rating", "win_rate", "games", "source"])

    frame = pd.DataFrame(rows)
    grouped = frame.groupby("club_code").agg(
        offense=("scored", "mean"),
        defense=("conceded", "mean"),
        win_rate=("won", "mean"),
        games=("scored", "size"),
    ).reset_index()
    grouped["net_rating"] = (grouped["offense"] - grouped["defense"]).round(2)
    grouped["offense"] = grouped["offense"].round(1)
    grouped["defense"] = grouped["defense"].round(1)
    grouped["win_rate"] = grouped["win_rate"].round(3)
    grouped["source"] = "temporada en curso"
    return grouped


def schedule_difficulty(
    games: list[dict[str, Any]],
    strength: pd.DataFrame,
    *,
    from_round: int,
    horizon: int = 3,
) -> pd.DataFrame:
    """Dificultad media de los próximos rivales, por club.

    Escala 0-100 donde 100 = calendario más duro de la liga. Se pondera algo el
    factor cancha: jugar fuera pesa más.
    """
    if strength.empty:
        return pd.DataFrame(columns=["club_code", "difficulty", "fixtures"])

    ratings = dict(zip(strength["club_code"], strength["net_rating"], strict=False))
    upcoming: dict[str, list[dict[str, Any]]] = {}

    for game in sorted(games, key=lambda g: (g.get("round") or 0, g.get("utcDate") or "")):
        round_number = game.get("round")
        if round_number is None or int(round_number) < from_round:
            continue
        local = ((game.get("local") or {}).get("club") or {}).get("code")
        road = ((game.get("road") or {}).get("club") or {}).get("code")
        if not local or not road:
            continue
        for club, rival, home in ((local, road, True), (road, local, False)):
            bucket = upcoming.setdefault(club, [])
            if len(bucket) < horizon:
                bucket.append(
                    {
                        "round": int(round_number),
                        "opponent": rival,
                        "home": home,
                        "date": game.get("utcDate"),
                        "opponent_rating": round(float(ratings.get(rival, 0.0)), 2),
                    }
                )

    rows = []
    for club, fixtures in upcoming.items():
        if not fixtures:
            continue
        raw = np.mean(
            [f["opponent_rating"] + (0.0 if f["home"] else 2.5) for f in fixtures]
        )
        rows.append({"club_code": club, "raw_difficulty": float(raw), "fixtures": fixtures})

    if not rows:
        return pd.DataFrame(columns=["club_code", "difficulty", "fixtures"])

    frame = pd.DataFrame(rows)
    low, high = frame["raw_difficulty"].min(), frame["raw_difficulty"].max()
    span = high - low
    frame["difficulty"] = ((frame["raw_difficulty"] - low) / span * 100).round(0) if span else 50.0
    return frame[["club_code", "difficulty", "fixtures", "raw_difficulty"]]


# ---------------------------------------------------------------------------
# Proyección y valor
# ---------------------------------------------------------------------------
def project_fantasy_points(table: pd.DataFrame, *, baseline: bool = False) -> pd.Series:
    """Proyección para la próxima jornada.

    Mezcla media de temporada y forma reciente, con el peso de la forma
    creciendo conforme hay más partidos, y un ajuste por tendencia de minutos.
    Sin partidos jugados cae de vuelta a la media que da el propio mercado.
    """
    fp_avg = pd.to_numeric(table.get("fp_avg"), errors="coerce").fillna(0.0)
    form = pd.to_numeric(table.get("form"), errors="coerce").fillna(0.0)
    games = pd.to_numeric(table.get("games_played"), errors="coerce").fillna(0.0)
    market_avg = pd.to_numeric(table.get("fpt"), errors="coerce").fillna(0.0)
    minutes_trend = pd.to_numeric(table.get("minutes_trend"), errors="coerce").fillna(0.0)
    fp_per_min = pd.to_numeric(table.get("fp_per_min"), errors="coerce").fillna(0.0)

    # Entre temporadas, la "forma reciente" son los últimos partidos de la
    # temporada ANTERIOR: mayo, otra plantilla, rotaciones cortas, eliminatorias
    # decididas. Pesarlos al máximo mandaba a cero a jugadores de 11 créditos.
    # Mientras la fuente sea la línea base, la proyección es la media.
    form_weight = 0.0 if baseline else np.clip(games / 10.0, 0.0, 0.6)
    blended = fp_avg * (1 - form_weight) + form * form_weight

    # Un cambio de rol se traduce en puntos vía su producción por minuto, pero
    # acotado EN RELATIVO: restarle 6 puntos a quien proyecta 4 es borrarlo.
    limit = (blended.abs() * 0.35).clip(upper=6.0)
    role_adjustment = (minutes_trend * fp_per_min).clip(lower=-limit, upper=limit)
    projection = blended + role_adjustment

    # Sin historial propio, el mercado es la mejor estimación disponible.
    projection = projection.where(games > 0, market_avg)
    return projection.clip(lower=0).round(2)


def value_metrics(table: pd.DataFrame) -> pd.DataFrame:
    """Ratios de valor por crédito y su normalización a percentiles."""
    out = table.copy()
    quotation = pd.to_numeric(out.get("quotation"), errors="coerce")
    safe_quotation = quotation.where(quotation > 0)

    out["value_per_credit"] = (pd.to_numeric(out.get("fp_avg"), errors="coerce") / safe_quotation).round(3)
    out["value_market"] = (pd.to_numeric(out.get("fpt"), errors="coerce") / safe_quotation).round(3)
    out["value_form"] = (pd.to_numeric(out.get("form"), errors="coerce") / safe_quotation).round(3)
    out["value_projected"] = (pd.to_numeric(out.get("projected_fp"), errors="coerce") / safe_quotation).round(3)

    # Cuando aún no hay partidos, el ratio útil es el que da el propio mercado.
    out["value_per_credit"] = out["value_per_credit"].fillna(out["value_market"])
    out["value_form"] = out["value_form"].fillna(out["value_market"])

    for column in ("value_projected", "projected_fp", "consistency", "price_pressure"):
        if column in out.columns:
            series = pd.to_numeric(out[column], errors="coerce")
            out[f"{column}_pct"] = (series.rank(pct=True) * 100).round(0)

    return out


def bargain_score(table: pd.DataFrame) -> pd.Series:
    """Índice compuesto de 'chollo': valor + consistencia + rol al alza.

    Deliberadamente simple y explicable: cada componente es un percentil, los
    pesos están a la vista y se pueden discutir. Un modelo opaco aquí no
    aportaría nada que no aporte esto, y no se podría justificar un fichaje.
    """
    def percentile(name: str, default: float = 50.0) -> pd.Series:
        if name not in table.columns:
            return pd.Series(default, index=table.index, dtype=float)
        series = pd.to_numeric(table[name], errors="coerce")
        if series.notna().sum() == 0:
            return pd.Series(default, index=table.index, dtype=float)
        return (series.rank(pct=True) * 100).fillna(default)

    score = (
        0.40 * percentile("value_projected")
        + 0.25 * percentile("projected_fp")
        + 0.15 * percentile("consistency")
        + 0.10 * percentile("minutes_share_trend")
        + 0.10 * percentile("price_pressure")
    )
    return score.round(1)
