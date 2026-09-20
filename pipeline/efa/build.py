"""Ensamblado final: de datos crudos a los JSON que consume la web.

Salidas en `web/src/data/`:

  players.json   una fila por jugador, con precio, rendimiento y señales
  teams.json     clubes, rating y dificultad de calendario
  lineup.json    plantilla óptima para el presupuesto inicial
  meta.json      estado de los datos: frescura, cobertura, avisos
  matching.json  informe del cruce de identidades (transparencia)

La web importa estos ficheros en build time, así que no hay backend que
mantener ni base de datos que se duerma: el commit del pipeline es el deploy.
"""
from __future__ import annotations

import csv
import json
import logging
import math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from efa.config import (
    CROSSWALK_PATH,
    CLUB_COLORS_PATH,
    PLAYER_OVERRIDES_PATH,
    PRIOR_SEASON_CODE,
    ROSTER_BUDGET,
    SEASON_CODE,
    UNMATCHED_REPORT_PATH,
    WEB_DATA_DIR,
    ensure_dirs,
)
from efa.demo import has_demo_data
from efa.gamelogs import build_coach_gamelog, build_gamelog, team_minutes_share
from efa.ingest.official import load_boxscores, load_reference
from efa.ingest.prices import latest_snapshot, load_snapshots
from efa.ingest.roster import current_round
from efa.matching import OfficialPlayer, PlayerMatcher, build_club_alias_map
from efa.metrics import (
    bargain_score,
    player_performance,
    price_history,
    price_pressure,
    project_fantasy_points,
    recent_series,
    schedule_difficulty,
    team_box_stats,
    team_strength,
    value_metrics,
)
from efa.optimizer import Candidate, normalize_position, optimize

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utilidades de serialización
# ---------------------------------------------------------------------------
def clean(value: Any) -> Any:
    """Convierte NaN/NaT/numpy a algo que `json.dumps` acepte."""
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if math.isnan(number) or math.isinf(number) else round(number, 4)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if value is pd.NaT:
        return None
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def write_json(name: str, payload: Any) -> None:
    ensure_dirs()
    path = WEB_DATA_DIR / name
    path.write_text(json.dumps(clean(payload), ensure_ascii=False, indent=1), encoding="utf-8")
    size_kb = path.stat().st_size / 1024
    log.info("  %s (%.0f KB)", name, size_kb)


# ---------------------------------------------------------------------------
# Cruce de identidades
# ---------------------------------------------------------------------------
def load_overrides() -> dict[int, str]:
    """Correcciones manuales fantaking_id -> person_code."""
    if not PLAYER_OVERRIDES_PATH.exists():
        return {}
    # El fichero admite comentarios con `#`, para poder anotar por qué se
    # corrigió cada caso sin que eso rompa la lectura.
    frame = pd.read_csv(PLAYER_OVERRIDES_PATH, dtype={"person_code": str}, comment="#")
    if frame.empty or "person_code" not in frame.columns:
        return {}
    frame = frame[frame["person_code"].notna() & (frame["person_code"].str.strip() != "")]
    return {int(row.fantaking_id): str(row.person_code).strip() for row in frame.itertuples()}


def build_crosswalk(market: pd.DataFrame, reference: dict[str, Any]) -> pd.DataFrame:
    """Empareja cada fila del mercado con el censo oficial."""
    official = [OfficialPlayer.from_feed(entry) for entry in reference.get("players", [])]
    official += [OfficialPlayer.from_feed(entry) for entry in reference.get("coaches", [])]
    alias_map = build_club_alias_map(reference.get("clubs", []))

    # Respaldo para pretemporada: en septiembre el censo oficial está a medias
    # y sin esto el cruce se hunde justo cuando hay que montar el equipo.
    prior_reference = load_reference(PRIOR_SEASON_CODE)
    prior = [OfficialPlayer.from_feed(entry) for entry in prior_reference.get("players", [])]
    prior += [OfficialPlayer.from_feed(entry) for entry in prior_reference.get("coaches", [])]

    matcher = PlayerMatcher(official, alias_map, load_overrides(), prior_players=prior)
    rows = [
        (int(row.fantaking_id), str(row.name_), str(row.team))
        for row in market.rename(columns={"name": "name_"}).itertuples()
    ]
    results = matcher.match_all(rows)

    frame = pd.DataFrame(
        [
            {
                "fantaking_id": r.fantaking_id,
                "fantaking_name": r.fantaking_name,
                "fantaking_team": r.fantaking_team,
                "club_code": r.club_code,
                "person_code": r.person_code,
                "official_name": r.official_name,
                "match_method": r.method,
                "match_confidence": round(r.confidence, 1),
            }
            for r in results
        ]
    )

    CROSSWALK_PATH.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(CROSSWALK_PATH, index=False, encoding="utf-8")

    # Solo se lleva al informe lo que de verdad pide un ojo humano: lo que no
    # cruzó, y lo que cruzó por una vía con margen de error. Un fichero de
    # revisión con doscientas filas correctas no lo revisa nadie.
    unmatched = frame[frame["person_code"].isna() | (frame["match_confidence"] < 90)]
    unmatched.to_csv(UNMATCHED_REPORT_PATH, index=False, encoding="utf-8")

    matched = int(frame["person_code"].notna().sum())
    log.info(
        "Cruce: %d/%d emparejados (%d dudosos en %s)",
        matched,
        len(frame),
        len(unmatched),
        UNMATCHED_REPORT_PATH.name,
    )
    return frame


# ---------------------------------------------------------------------------
# Game log con línea base
# ---------------------------------------------------------------------------
def _pick_image(*sources: dict[str, Any] | None) -> str | None:
    """La foto puede venir en el registro de temporada o dentro de `person`."""
    for images in sources:
        if not images:
            continue
        url = images.get("headshot") or images.get("action")
        if url:
            return str(url)
    return None


def headshot_index(*seasons: str) -> dict[str, str]:
    """Fotos de jugador, con la temporada anterior como respaldo.

    El censo de la temporada nueva llega sin fotos hasta bien entrado
    septiembre. Las de la anterior sirven igual: es la misma persona y el mismo
    CDN oficial. Se recorren en el orden dado, así que la temporada actual gana
    en cuanto publique las suyas.
    """
    index: dict[str, str] = {}

    for season in seasons:
        reference = load_reference(season)
        for entry in list(reference.get("players", [])) + list(reference.get("coaches", [])):
            person = entry.get("person") or {}
            code = str(person.get("code") or "")
            url = _pick_image(entry.get("images"), person.get("images"))
            if code and url:
                index.setdefault(code, url)

    for season in seasons:
        for payload in load_boxscores(season).values():
            for side in ("local", "road"):
                for entry in (payload.get(side) or {}).get("players", []):
                    player = entry.get("player") or {}
                    person = player.get("person") or {}
                    code = str(person.get("code") or "")
                    url = _pick_image(player.get("images"), person.get("images"))
                    if code and url:
                        index.setdefault(code, url)

    return index


def resolve_gamelog(reference: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Game log de la temporada actual, o de la anterior si aún no hay partidos."""
    games = reference.get("games", [])
    boxscores = load_boxscores(SEASON_CODE)
    if boxscores:
        gamelog = build_gamelog(boxscores, games)
        if not gamelog.empty:
            return team_minutes_share(gamelog), {
                "source": SEASON_CODE,
                "isBaseline": False,
                "games": len(boxscores),
            }

    prior_boxscores = load_boxscores(PRIOR_SEASON_CODE)
    if prior_boxscores:
        prior_reference = load_reference(PRIOR_SEASON_CODE)
        gamelog = build_gamelog(prior_boxscores, prior_reference.get("games", []))
        log.info(
            "Sin partidos en %s: se usa %s como línea base (%d partidos).",
            SEASON_CODE,
            PRIOR_SEASON_CODE,
            len(prior_boxscores),
        )
        return team_minutes_share(gamelog), {
            "source": PRIOR_SEASON_CODE,
            "isBaseline": True,
            "games": len(prior_boxscores),
        }

    return pd.DataFrame(), {"source": None, "isBaseline": False, "games": 0}


# ---------------------------------------------------------------------------
# Tabla maestra
# ---------------------------------------------------------------------------
MARKET_STAT_FIELDS = {
    "fpt": "fpt",
    "pts": "points",
    "reb": "rebounds",
    "ast": "assists",
    "stl": "steals",
    "tov": "turnovers",
    "blk": "blocksFavour",
    "blka": "blocksAgainst",
    "fd": "foulsDrawn",
    "pf": "foulsCommitted",
    "fg_missed": "missedFg",
    "ft_missed": "missedFt",
    "plus": "priceChangeReported",
}


def build_player_table(
    market: pd.DataFrame,
    crosswalk: pd.DataFrame,
    performance: pd.DataFrame,
    prices: pd.DataFrame,
    reference: dict[str, Any],
    images: dict[str, str] | None = None,
    *,
    baseline: bool = False,
) -> pd.DataFrame:
    """Une mercado, identidad, precio histórico y rendimiento en una sola tabla."""
    table = market.merge(crosswalk, on="fantaking_id", how="left", suffixes=("", "_cw"))

    if not prices.empty:
        table = table.merge(prices, on="fantaking_id", how="left", suffixes=("", "_hist"))
        if "quotation_hist" in table.columns:
            table["quotation"] = table["quotation"].fillna(table["quotation_hist"])
    else:
        # Sin histórico no hay variación que mostrar: nulo, no cero. Un cero
        # afirma que el precio no se ha movido, y eso no lo sabemos.
        table["quotation_open"] = table.get("quotation")
        table["price_delta_last"] = np.nan
        table["price_delta_total"] = np.nan
        table["price_points"] = [[] for _ in range(len(table))]
        table["snapshots"] = 0

    if not performance.empty:
        table = table.merge(performance, on="person_code", how="left")

    # Metadatos del jugador desde el censo oficial.
    people_index: dict[str, dict[str, Any]] = {}
    for entry in list(reference.get("players", [])) + list(reference.get("coaches", [])):
        person = entry.get("person") or {}
        code = str(person.get("code", ""))
        if not code:
            continue
        people_index[code] = {
            "image": _pick_image(entry.get("images"), person.get("images")),
            "height": person.get("height"),
            "country": (person.get("country") or {}).get("code"),
            "birth_date": (person.get("birthDate") or "")[:10] or None,
            "official_position": entry.get("positionName"),
            "dorsal": entry.get("dorsal"),
            "person_type": entry.get("type"),
        }

    for column, key in (
        ("image", "image"),
        ("height", "height"),
        ("country", "country"),
        ("birth_date", "birth_date"),
        ("official_position", "official_position"),
        ("dorsal", "dorsal"),
        ("person_type", "person_type"),
    ):
        table[column] = table["person_code"].map(
            lambda code, k=key: people_index.get(str(code), {}).get(k) if pd.notna(code) else None
        )

    if images:
        # Ojo: una columna de solo None puede acabar como float64, y NaN es
        # truthy — un `or` aquí se quedaría con el NaN en vez de la foto.
        def resolve_image(row: pd.Series) -> str | None:
            current = row.get("image")
            if isinstance(current, str) and current:
                return current
            return images.get(str(row.get("person_code")))

        table["image"] = table.apply(resolve_image, axis=1)

    table["position_group"] = table.apply(
        lambda row: normalize_position(row.get("position")) or normalize_position(row.get("official_position")),
        axis=1,
    )
    table["is_coach"] = table["person_type"].eq("C") | table["position_group"].isna()

    table["projected_fp"] = project_fantasy_points(table, baseline=baseline)
    table["price_pressure"] = price_pressure(table)
    table = value_metrics(table)
    table["bargain_score"] = bargain_score(table)
    return table


def player_records(
    table: pd.DataFrame,
    series: dict[str, list[dict[str, Any]]],
    difficulty: pd.DataFrame,
    clubs_index: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convierte la tabla maestra en la lista de objetos que lee el front."""
    difficulty_index = {
        row["club_code"]: {"difficulty": row["difficulty"], "fixtures": row["fixtures"]}
        for _, row in difficulty.iterrows()
    } if not difficulty.empty else {}

    records: list[dict[str, Any]] = []
    for _, row in table.iterrows():
        person_code = row.get("person_code")
        club_code = row.get("club_code")
        club = clubs_index.get(str(club_code), {})
        schedule = difficulty_index.get(str(club_code), {})

        market_stats = {
            target: row.get(source)
            for source, target in MARKET_STAT_FIELDS.items()
            if source in table.columns
        }

        records.append(
            {
                "id": int(row["fantaking_id"]),
                "personCode": str(person_code) if pd.notna(person_code) else None,
                "name": row.get("official_name") or row.get("name"),
                "marketName": row.get("name"),
                "club": club_code,
                "clubName": club.get("name"),
                "clubShort": club.get("editorialName") or club.get("abbreviatedName"),
                "clubCrest": (club.get("images") or {}).get("crest"),
                "position": row.get("position_group"),
                "positionLabel": row.get("official_position") or row.get("position"),
                "isCoach": bool(row.get("is_coach")),
                "dorsal": row.get("dorsal"),
                "image": row.get("image"),
                "height": row.get("height"),
                "country": row.get("country"),
                "birthDate": row.get("birth_date"),
                "price": row.get("quotation"),
                "priceOpen": row.get("quotation_open"),
                "priceDeltaLast": row.get("price_delta_last"),
                "priceDeltaTotal": row.get("price_delta_total"),
                "priceSnapshots": row.get("snapshots"),
                "market": market_stats,
                "perf": {
                    "games": row.get("games"),
                    "gamesPlayed": row.get("games_played"),
                    "minutesAvg": row.get("minutes_avg"),
                    "minutesRecent": row.get("minutes_recent"),
                    "minutesTrend": row.get("minutes_trend"),
                    "minutesShareRecent": row.get("minutes_share_recent"),
                    "minutesShareTrend": row.get("minutes_share_trend"),
                    "fpAvg": row.get("fp_avg"),
                    "fpMedian": row.get("fp_median"),
                    "fpStd": row.get("fp_std"),
                    "fpFloor": row.get("fp_floor"),
                    "fpCeiling": row.get("fp_ceiling"),
                    "fpPerMin": row.get("fp_per_min"),
                    "consistency": row.get("consistency"),
                    "form": row.get("form"),
                    "formDelta": row.get("form_delta"),
                    "lastFp": row.get("last_fp"),
                    "startedRate": row.get("started_rate"),
                    "dnpRate": row.get("dnp_rate"),
                    "ptsAvg": row.get("pts_avg"),
                    "rebAvg": row.get("reb_avg"),
                    "astAvg": row.get("ast_avg"),
                    "pirAvg": row.get("pir_avg"),
                    "plusMinusAvg": row.get("plus_minus_avg"),
                },
                "projectedFp": row.get("projected_fp"),
                "valuePerCredit": row.get("value_per_credit"),
                "valueProjected": row.get("value_projected"),
                "valueMarket": row.get("value_market"),
                "pricePressure": row.get("price_pressure"),
                "bargainScore": row.get("bargain_score"),
                "schedule": {"difficulty": schedule.get("difficulty")},
                "match": {
                    "method": row.get("match_method"),
                    "confidence": row.get("match_confidence"),
                },
            }
        )
    return records


def player_details(
    table: pd.DataFrame,
    series: dict[str, list[dict[str, Any]]],
    difficulty: pd.DataFrame,
) -> dict[str, dict[str, Any]]:
    """Series largas por jugador, en su propio fichero.

    El listado de mercado carga 350 filas; el historial de precios y el game log
    solo hacen falta en la ficha individual. Separarlos mantiene la página
    principal ligera según crece el histórico.
    """
    fixtures_index = (
        {row["club_code"]: row["fixtures"] for _, row in difficulty.iterrows()}
        if not difficulty.empty
        else {}
    )

    details: dict[str, dict[str, Any]] = {}
    for _, row in table.iterrows():
        person_code = row.get("person_code")
        price_points = row.get("price_points")
        details[str(int(row["fantaking_id"]))] = {
            "priceHistory": price_points if isinstance(price_points, list) else [],
            "recent": series.get(str(person_code), []) if pd.notna(person_code) else [],
            "fixtures": fixtures_index.get(str(row.get("club_code")), []),
        }
    return details


# ---------------------------------------------------------------------------
# Orquestación
# ---------------------------------------------------------------------------
def build(*, budget: float = ROSTER_BUDGET) -> dict[str, Any]:
    """Genera todos los JSON de la web. No toca la red."""
    ensure_dirs()
    reference = load_reference(SEASON_CODE)
    if not reference.get("clubs"):
        raise RuntimeError(
            "Faltan datos oficiales. Ejecuta primero `efa ingest-official`."
        )

    market = latest_snapshot()
    has_prices = not market.empty
    if not has_prices:
        log.warning(
            "No hay ningún snapshot de precios en data/raw/prices/. "
            "Se construye la web solo con datos oficiales."
        )
        market = _market_from_official(reference)

    gamelog, gamelog_meta = resolve_gamelog(reference)
    performance = player_performance(gamelog)
    series = recent_series(gamelog)

    crosswalk = build_crosswalk(market, reference)
    prices = price_history(load_snapshots()) if has_prices else pd.DataFrame()

    images = headshot_index(SEASON_CODE, PRIOR_SEASON_CODE)
    table = build_player_table(
        market,
        crosswalk,
        performance,
        prices,
        reference,
        images,
        baseline=bool(gamelog_meta.get("isBaseline")),
    )

    games = reference.get("games", [])
    round_now = current_round(games)
    prior_reference = load_reference(PRIOR_SEASON_CODE)
    prior_strength = team_strength(prior_reference.get("games", []))
    strength = team_strength(games, prior=prior_strength)
    difficulty = schedule_difficulty(games, strength, from_round=round_now, horizon=3)

    clubs_index = {club["code"]: club for club in reference.get("clubs", [])}
    records = player_records(table, series, difficulty, clubs_index)

    coach_log = build_coach_gamelog(load_boxscores(SEASON_CODE), games)
    if coach_log.empty:
        # Igual que con los jugadores: si la temporada en curso no tiene
        # partidos, la referencia es la anterior.
        coach_log = build_coach_gamelog(
            load_boxscores(PRIOR_SEASON_CODE), prior_reference.get("games", [])
        )
    _apply_coach_projections(records, coach_log)

    lineup = _build_optimal_lineup(records, budget=budget)

    matched = int(table["person_code"].notna().sum())
    meta = {
        "season": SEASON_CODE,
        "seasonLabel": f"EuroLeague {_season_label(SEASON_CODE)}",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "currentRound": round_now,
        "totalRounds": max((int(g["round"]) for g in games if g.get("round")), default=0),
        "hasPrices": has_prices,
        "isDemo": has_demo_data(),
        "priceSnapshots": int(prices["snapshots"].max()) if not prices.empty else 0,
        "lastPriceCapture": market["captured_at"].max().isoformat()
        if has_prices and hasattr(market["captured_at"].max(), "isoformat")
        else None,
        "performanceSource": gamelog_meta,
        "teamStrengthSource": strength["source"].iloc[0] if not strength.empty else None,
        "players": len(records),
        "matched": matched,
        "matchRate": round(matched / len(records), 3) if records else 0.0,
        "budget": budget,
        "coachGames": int(len(coach_log)),
        "warnings": _warnings(has_prices, gamelog_meta, matched, len(records)),
    }

    # Índices de equipo desde los boxscores de la misma temporada que sirve de
    # referencia para los jugadores, para que la ficha de club y la de jugador
    # no cuenten cosas distintas.
    box_season = gamelog_meta.get("source") or SEASON_CODE
    box_games = games if box_season == SEASON_CODE else prior_reference.get("games", [])
    team_box = team_box_stats(load_boxscores(box_season), box_games)

    teams = _team_records(
        reference.get("clubs", []),
        strength,
        difficulty,
        team_box,
        load_club_colors(),
    )

    write_json("players.json", records)
    write_json("details.json", player_details(table, series, difficulty))
    write_json("teams.json", teams)
    write_json("lineup.json", lineup)
    write_json("meta.json", meta)
    write_json(
        "matching.json",
        crosswalk.sort_values("match_confidence").to_dict(orient="records"),
    )

    return meta


def _market_from_official(reference: dict[str, Any]) -> pd.DataFrame:
    """Tabla de mercado mínima cuando aún no hay ningún snapshot de precios.

    Permite que el repo compile y la web se despliegue antes de la primera
    captura. Precio a nulo: la interfaz lo señala en vez de inventarlo.
    """
    rows = []
    for index, entry in enumerate(reference.get("players", [])):
        person = entry.get("person") or {}
        club = entry.get("club") or {}
        rows.append(
            {
                "fantaking_id": -(index + 1),
                "name": person.get("name", ""),
                "team": club.get("name", ""),
                "position": entry.get("positionName", ""),
                "quotation": np.nan,
                "fpt": np.nan,
                "captured_at": pd.Timestamp.now(tz="UTC"),
            }
        )
    return pd.DataFrame(rows)


def _usable_number(value: Any) -> float | None:
    """float() que descarta NaN — `float('nan')` es truthy y se cuela en los filtros."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(number) or math.isinf(number) else number


def _apply_coach_projections(
    records: list[dict[str, Any]], coach_log: pd.DataFrame
) -> int:
    """Proyección del entrenador: su media histórica de puntos fantasy.

    Puntúa al 100 % y cuesta entre 5 y 10 de los 100 créditos, así que dejarlo
    en 0 era elegirlo a ciegas. Su puntuación no sale de estadísticas suyas
    sino del margen con el que gane o pierda su equipo (+10/+20/+25 y
    −5/−10/−20), de modo que la media de lo que lleva hecho es la mejor
    estimación disponible. Si no hay histórico suyo se usa el del banquillo de
    su club: los entrenadores cambian, el equipo no tanto.
    """
    if coach_log is None or coach_log.empty:
        return 0

    by_person = coach_log.groupby("person_code")["fantasy_points"].mean()
    by_club = coach_log.groupby("club_code")["fantasy_points"].mean()

    applied = 0
    for record in records:
        if not record.get("isCoach"):
            continue
        value = by_person.get(str(record.get("personCode")))
        if value is None or pd.isna(value):
            value = by_club.get(str(record.get("club")))
        if value is None or pd.isna(value):
            continue
        record["projectedFp"] = round(float(value), 2)
        applied += 1

    log.info("Proyección de entrenador aplicada a %d fichas", applied)
    return applied


def _build_optimal_lineup(records: list[dict[str, Any]], *, budget: float) -> dict[str, Any]:
    candidates = []
    coaches = []
    for record in records:
        price = _usable_number(record.get("price"))
        projection = _usable_number(record.get("projectedFp"))
        if price is None or price <= 0:
            continue
        if record["isCoach"]:
            # El entrenador compite por el mismo presupuesto: es obligatorio y
            # cuesta entre 5 y 10 créditos. Antes se optimizaban los diez con
            # los 100 enteros y salía una plantilla que no se podía alinear.
            coaches.append(
                Candidate(
                    key=str(record["id"]),
                    name=record["name"] or "",
                    position="E",
                    club_code=record["club"] or "",
                    price=price,
                    projection=projection or 0.0,
                )
            )
            continue
        if record["position"] not in {"G", "F", "C"} or projection is None:
            continue
        candidates.append(
            Candidate(
                key=str(record["id"]),
                name=record["name"] or "",
                position=record["position"],
                club_code=record["club"] or "",
                price=price,
                projection=projection,
            )
        )
    if len(candidates) < 10:
        return {"available": False, "reason": "Faltan precios o proyecciones para optimizar."}

    lineup = optimize(candidates, budget=budget, coaches=coaches)
    if lineup is None:
        return {"available": False, "reason": "No hay ninguna combinación válida dentro del presupuesto."}

    payload = lineup.as_dict()
    payload["available"] = True
    payload["budget"] = budget
    return payload


BOX_FIELDS = {
    "box_games": "games",
    "wins": "wins",
    "losses": "losses",
    "ppg": "ppg",
    "papg": "papg",
    "off_rating": "offRating",
    "def_rating": "defRating",
    "net_rating": "netRating",
    "pace": "pace",
    "efg": "efg",
    "tov_rate": "tovRate",
    "orb_rate": "orbRate",
    "ft_rate": "ftRate",
    "ast_pg": "astPerGame",
    "three_rate": "threeRate",
}


def load_club_colors() -> dict[str, dict[str, str]]:
    """Colores de club fijados a mano, con el mismo formato que los overrides
    de jugador: las líneas que empiezan por # se ignoran.

    No se extraen del escudo en cada build a propósito. Serían veinte descargas
    de imagen y una dependencia de tratamiento de imagen dentro del Action, para
    un dato que solo cambia cuando un club rediseña su escudo. Se calculó una
    vez y vive en el repo.
    """
    if not CLUB_COLORS_PATH.exists():
        return {}
    colors: dict[str, dict[str, str]] = {}
    with CLUB_COLORS_PATH.open(encoding="utf-8") as handle:
        rows = csv.DictReader(line for line in handle if not line.lstrip().startswith("#"))
        for row in rows:
            code = (row.get("code") or "").strip()
            if not code:
                continue
            colors[code] = {
                "halo": (row.get("halo") or "").strip() or None,
                "statDark": (row.get("stat_dark") or "").strip() or None,
                "statLight": (row.get("stat_light") or "").strip() or None,
            }
    return colors


def _team_records(
    clubs: list[dict[str, Any]],
    strength: pd.DataFrame,
    difficulty: pd.DataFrame,
    box: pd.DataFrame | None = None,
    colors: dict[str, dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    strength_index = strength.set_index("club_code").to_dict(orient="index") if not strength.empty else {}
    difficulty_index = difficulty.set_index("club_code").to_dict(orient="index") if not difficulty.empty else {}
    box_index = (
        box.set_index("club_code").to_dict(orient="index")
        if box is not None and not box.empty
        else {}
    )
    colors = colors or {}

    out = []
    for club in clubs:
        code = club["code"]
        stats = strength_index.get(code, {})
        schedule = difficulty_index.get(code, {})
        box_row = box_index.get(code)
        out.append(
            {
                "code": code,
                "name": club.get("name"),
                "short": club.get("editorialName") or club.get("abbreviatedName"),
                "country": (club.get("country") or {}).get("code"),
                "crest": (club.get("images") or {}).get("crest"),
                "offense": stats.get("offense"),
                "defense": stats.get("defense"),
                "netRating": stats.get("net_rating"),
                "winRate": stats.get("win_rate"),
                "games": stats.get("games"),
                "ratingSource": stats.get("source"),
                "difficulty": schedule.get("difficulty"),
                "fixtures": schedule.get("fixtures", []),
                # Nulo, no ceros: un club recién llegado no tiene histórico y la
                # web tiene que poder decirlo.
                "box": (
                    {target: _usable_number(box_row.get(source)) for source, target in BOX_FIELDS.items()}
                    if box_row
                    else None
                ),
                "colors": colors.get(code),
            }
        )
    return out


def _season_label(season_code: str | None) -> str:
    """E2026 -> 2026-27."""
    if not season_code or not season_code[1:].isdigit():
        return str(season_code or "—")
    year = int(season_code[1:])
    return f"{year}-{str(year + 1)[-2:]}"


def _warnings(has_prices: bool, gamelog_meta: dict[str, Any], matched: int, total: int) -> list[str]:
    notes: list[str] = []
    if not has_prices:
        notes.append(
            "Sin snapshot de precios: ejecuta `efa snapshot` con tu FANTAKING_TOKEN."
        )
    if gamelog_meta.get("isBaseline"):
        notes.append(
            f"La temporada {_season_label(SEASON_CODE)} aún no tiene partidos jugados: "
            f"el rendimiento mostrado es la línea base de la {_season_label(gamelog_meta['source'])}."
        )
    if has_demo_data():
        notes.append(
            "Este despliegue lleva precios de DEMOSTRACIÓN, derivados del rendimiento "
            "real pero inventados. No los uses para decidir un fichaje."
        )
    if total and matched / total < 0.95:
        missing = total - matched
        notes.append(
            f"{missing} de {total} jugadores del mercado no están todavía en el censo "
            "oficial de la EuroLeague. En pretemporada es normal: los clubes aún están "
            "inscribiendo plantillas y el censo se completa solo conforme avanzan los "
            "días. Esos jugadores se muestran con precio pero sin histórico. "
            "El detalle está en data/processed/unmatched_players.csv."
        )
    return notes
