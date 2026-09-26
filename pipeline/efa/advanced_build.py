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
from efa.gamelogs import build_gamelog
from efa.ingest.official import load_boxscores, load_player_stats, load_reference
from efa.ingest.playbyplay import load_pbp, shots_frame

log = logging.getLogger(__name__)

#: Partidos de esta temporada a partir de los cuales ya no se mira la anterior.
CURRENT_ENOUGH = 5
#: Desviación típica del entrenador: puntúa −20…+25 según el margen.
COACH_SD = 11.0
POSITION_FROM_OFFICIAL = {"Guard": "G", "Forward": "F", "Center": "C"}

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


def _season_label(code: str) -> str:
    year = int(code[1:])
    return f"{year}-{str(year + 1)[-2:]}"


# ---------------------------------------------------------------------------
# Piezas
# ---------------------------------------------------------------------------
def _positions(records: list[dict[str, Any]], references: list[dict[str, Any]]) -> dict[str, str]:
    """person_code -> G/F/C: el del juego si está en el mercado; si no, el oficial."""
    out: dict[str, str] = {}
    for reference in references:
        for entry in reference.get("players", []):
            code = str((entry.get("person") or {}).get("code") or "")
            pos = POSITION_FROM_OFFICIAL.get(str(entry.get("positionName") or ""))
            if code and pos:
                out.setdefault(code, pos)
    for record in records:
        if record.get("personCode") and record.get("position") in ("G", "F", "C"):
            out[str(record["personCode"])] = record["position"]
    return out


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
        proj = _num(record.get("projectedFp")) or 0.0
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
        out[int(record["id"])] = round(math.sqrt(weight * cur**2 + (1 - weight) * base**2), 2)
    return out


def _price_frame(market: pd.DataFrame, crosswalk: pd.DataFrame, current: pd.DataFrame) -> pd.DataFrame:
    """Para ajustar el modelo de precio: la última puntuación de cada jugador en
    un partido ANTERIOR a la captura (si no, `plus` todavía no la refleja)."""
    if current.empty or "plus" not in market.columns:
        return pd.DataFrame(columns=["last_fp", "quotation", "plus"])
    captured = pd.to_datetime(market["captured_at"], utc=True).max()
    log = current[current["played"]].copy()
    log["date"] = pd.to_datetime(log["utc_date"], utc=True, errors="coerce")
    log = log[log["date"] < captured - pd.Timedelta(hours=2)]
    if log.empty:
        return pd.DataFrame(columns=["last_fp", "quotation", "plus"])
    last = log.sort_values("date").groupby("person_code").tail(1)
    # Solo si su ÚLTIMO partido de club es ese: si el club jugó después y él no,
    # la variación ya descuenta otro partido.
    latest_by_club = current.assign(date=pd.to_datetime(current["utc_date"], utc=True, errors="coerce"))
    latest_by_club = latest_by_club[latest_by_club["date"] < captured - pd.Timedelta(hours=2)]
    club_last = latest_by_club.groupby("club_code")["game_code"].max()
    last = last[last.apply(lambda r: club_last.get(r["club_code"]) == r["game_code"], axis=1)]
    frame = (
        market[["fantaking_id", "quotation", "plus"]]
        .merge(crosswalk[["fantaking_id", "person_code"]], on="fantaking_id")
        .merge(last[["person_code", "fantasy_points"]], on="person_code")
        .rename(columns={"fantasy_points": "last_fp"})
    )
    return frame


# ---------------------------------------------------------------------------
# Todo junto
# ---------------------------------------------------------------------------
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
) -> None:
    """Muta los cuatro objetos añadiendo la capa avanzada."""
    prior_reference = load_reference(PRIOR_SEASON_CODE)
    box_now = load_boxscores(SEASON_CODE)
    box_prior = load_boxscores(PRIOR_SEASON_CODE)
    log_now = build_gamelog(box_now, reference.get("games", [])) if box_now else pd.DataFrame()
    log_prior = build_gamelog(box_prior, prior_reference.get("games", [])) if box_prior else pd.DataFrame()
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
    model = fit_price_model(_price_frame(market, crosswalk, log_now))
    sds = _projection_sd(records, log_now, log_prior)
    for record in records:
        price = _num(record.get("price"))
        proj = _num(record.get("projectedFp"))
        sd = sds.get(int(record["id"]))
        if price is None or price <= 0 or proj is None or sd is None:
            record["outlook"] = None
            continue
        threshold = break_even(model, price)
        record["outlook"] = {
            "breakEven": round(threshold, 1),
            "expectedChange": round(max(-1.5, min(1.5, expected_change(model, proj, price))), 2),
            "riseProb": round(prob_above(threshold, proj, sd), 3),
            "sd": sd,
            "floor": round(proj - 0.674 * sd, 1),
            "ceiling": round(proj + 0.674 * sd, 1),
        }
    meta["priceModel"] = {**DEFAULT_PRICE_MODEL, **model}

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
    positions = _positions(records, [reference, prior_reference])
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
        "seasonLabels": {SEASON_CODE: _season_label(SEASON_CODE), PRIOR_SEASON_CODE: _season_label(PRIOR_SEASON_CODE)},
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
        str((entry.get("person") or {}).get("code")): POSITION_FROM_OFFICIAL.get(str(entry.get("positionName") or ""))
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

