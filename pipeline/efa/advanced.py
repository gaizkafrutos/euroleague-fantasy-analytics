"""Estadísticas avanzadas: lo que sale del jugada a jugada, de los tiros y de
cruzar el game log con el precio.

Todo aquí es cálculo puro sobre datos ya descargados; no toca la red.

  analyse_game()          quién estuvo en pista cada segundo de un partido:
                          minutos por cuarto, minutos en el final apretado,
                          puntos a favor/en contra y posesiones con cada
                          jugador y cada quinteto en pista.
  player_court_stats()    on/off y reparto de minutos por temporada.
  team_lineups()          quintetos más usados de cada club.
  zone_of() / shot_zones  tiros por zona frente a la media de la liga.
  fantasy_mix()           de qué acciones salen los puntos fantasy.
  allowed_by_position()   puntos fantasy que concede cada club a bases,
                          aleros y pívots rivales.
  quarter_splits()        parciales por cuarto de cada club.
  fit_price_model()       de qué depende la variación de precio del juego.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Zonas de tiro
# ---------------------------------------------------------------------------
#: Diez zonas, del aro hacia fuera. Coordenadas en cm respecto al aro:
#: x lateral (negativo = izquierda mirando al aro desde el centro del campo),
#: y hacia el centro del campo. Medidas FIBA: triple a 6,75 m y 6,60 m en las
#: esquinas, zona de 4,90 m de ancho que acaba 4,225 m por delante del aro.
ZONES: list[tuple[str, str]] = [
    ("rim", "Aro"),
    ("paint", "Pintura"),
    ("mid_l", "Media izquierda"),
    ("mid_c", "Media frontal"),
    ("mid_r", "Media derecha"),
    ("c3_l", "Esquina izquierda"),
    ("ab3_l", "Triple izquierda"),
    ("ab3_c", "Triple frontal"),
    ("ab3_r", "Triple derecha"),
    ("c3_r", "Esquina derecha"),
]
ZONE_INDEX = {key: i for i, (key, _) in enumerate(ZONES)}

RIM_RADIUS = 125
PAINT_HALF_WIDTH = 245
PAINT_DEPTH = 423
CORNER_Y = 150
FRONT_ANGLE = 22.0


def zone_of(x: float, y: float, value: int) -> str:
    """Zona de un tiro por sus coordenadas y su valor (2 o 3)."""
    angle = math.degrees(math.atan2(x, max(y, 1e-6)))
    if value == 3:
        if y < CORNER_Y:
            return "c3_l" if x < 0 else "c3_r"
        if abs(angle) <= FRONT_ANGLE:
            return "ab3_c"
        return "ab3_l" if x < 0 else "ab3_r"
    if math.hypot(x, y) <= RIM_RADIUS:
        return "rim"
    if abs(x) <= PAINT_HALF_WIDTH and y <= PAINT_DEPTH:
        return "paint"
    if abs(angle) <= FRONT_ANGLE:
        return "mid_c"
    return "mid_l" if x < 0 else "mid_r"


def add_zones(shots: pd.DataFrame) -> pd.DataFrame:
    if shots.empty:
        return shots.assign(zone=pd.Series(dtype=str))
    zones = [zone_of(x, y, v) for x, y, v in zip(shots["x"], shots["y"], shots["value"], strict=False)]
    return shots.assign(zone=zones)


def zone_table(shots: pd.DataFrame) -> list[list[int]]:
    """[[intentos, anotados], …] en el orden de ZONES."""
    out = [[0, 0] for _ in ZONES]
    if shots.empty:
        return out
    grouped = shots.groupby("zone")["made"].agg(["size", "sum"])
    for zone, row in grouped.iterrows():
        idx = ZONE_INDEX.get(str(zone))
        if idx is not None:
            out[idx] = [int(row["size"]), int(row["sum"])]
    return out


# ---------------------------------------------------------------------------
# Quién está en pista
# ---------------------------------------------------------------------------
_FGA = {"2FGM", "2FGA", "3FGM", "3FGA"}
_FTA = {"FTM", "FTA"}


@dataclass
class _Acc:
    seconds: float = 0.0
    by_period: list[float] = field(default_factory=lambda: [0.0] * 5)
    clutch: float = 0.0
    pts_for: float = 0.0
    pts_against: float = 0.0
    poss_off: float = 0.0
    poss_def: float = 0.0
    #: Posesiones que acaba él: tiro de campo, 0,44 por tiro libre, pérdida.
    used: float = 0.0


def _box_sides(box: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """club -> {players: {code: (starter, seconds)}}."""
    out: dict[str, dict[str, Any]] = {}
    for side in ("local", "road"):
        block = box.get(side) or {}
        players = block.get("players") or []
        if not players:
            continue
        club = str(((players[0].get("player") or {}).get("club") or {}).get("code") or "")
        out[club] = {
            "players": {
                str(((p.get("player") or {}).get("person") or {}).get("code")): (
                    bool((p.get("stats") or {}).get("startFive")),
                    float((p.get("stats") or {}).get("timePlayed") or 0),
                )
                for p in players
            }
        }
    return out


def analyse_game(pbp: dict[str, Any], box: dict[str, Any], *, tolerance: float = 90.0) -> dict[str, Any] | None:
    """Reconstruye quién estuvo en pista y qué pasó con cada uno.

    Devuelve None si la reconstrucción no cuadra con el boxscore (algún
    jugador con más de `tolerance` segundos de diferencia): mejor no publicar
    un on/off que publicarlo mal. En la J1 cuadran los 240 jugadores a menos de
    30 s y el ± de 236 de 240 al punto.
    """
    team_a, team_b = pbp.get("teamA"), pbp.get("teamB")
    sides = _box_sides(box)
    if team_a not in sides or team_b not in sides:
        return None
    opponent = {team_a: team_b, team_b: team_a}
    on: dict[str, set[str]] = {
        team: {code for code, (starter, _) in sides[team]["players"].items() if starter}
        for team in (team_a, team_b)
    }
    if any(len(players) != 5 for players in on.values()):
        return None

    players: dict[str, _Acc] = defaultdict(_Acc)
    player_team: dict[str, str] = {}
    for team in (team_a, team_b):
        for code in sides[team]["players"]:
            player_team[code] = team
    lineups: dict[tuple[str, tuple[str, ...]], _Acc] = defaultdict(_Acc)
    team_acc: dict[str, _Acc] = defaultdict(_Acc)

    score = {team_a: 0, team_b: 0}
    last_t = 0.0
    period = 1

    def credit_time(dt: float, period_now: int, clutch: bool) -> None:
        if dt <= 0:
            return
        slot = min(period_now, 5) - 1
        for team in (team_a, team_b):
            key = (team, tuple(sorted(on[team])))
            lineups[key].seconds += dt
            team_acc[team].seconds += dt
            for code in on[team]:
                acc = players[code]
                acc.seconds += dt
                acc.by_period[slot] += dt
                if clutch:
                    acc.clutch += dt

    def credit(team: str, attr_for: str, attr_against: str, amount: float) -> None:
        other = opponent[team]
        for code in on[team]:
            setattr(players[code], attr_for, getattr(players[code], attr_for) + amount)
        for code in on[other]:
            setattr(players[code], attr_against, getattr(players[code], attr_against) + amount)
        key_own = (team, tuple(sorted(on[team])))
        key_other = (other, tuple(sorted(on[other])))
        setattr(lineups[key_own], attr_for, getattr(lineups[key_own], attr_for) + amount)
        setattr(lineups[key_other], attr_against, getattr(lineups[key_other], attr_against) + amount)
        setattr(team_acc[team], attr_for, getattr(team_acc[team], attr_for) + amount)
        setattr(team_acc[other], attr_against, getattr(team_acc[other], attr_against) + amount)

    for p, second, kind, team, player, pts_a, pts_b in pbp.get("events") or []:
        # Final apretado: últimos 5 minutos del último cuarto o cualquier
        # prórroga, con 5 puntos o menos de diferencia al empezar el tramo.
        in_clutch_window = (period == 4 and last_t >= 2100) or period >= 5
        clutch = in_clutch_window and abs(score[team_a] - score[team_b]) <= 5
        credit_time(float(second) - last_t, period, clutch)
        last_t = max(last_t, float(second))
        period = max(int(p or 1), 1)

        if pts_a is not None or pts_b is not None:
            new_a = int(pts_a) if pts_a is not None else score[team_a]
            new_b = int(pts_b) if pts_b is not None else score[team_b]
            if new_a != score[team_a]:
                credit(team_a, "pts_for", "pts_against", new_a - score[team_a])
            if new_b != score[team_b]:
                credit(team_b, "pts_for", "pts_against", new_b - score[team_b])
            score = {team_a: new_a, team_b: new_b}

        if team in on and player:
            if kind in _FGA or kind == "TO":
                players[player].used += 1.0
            elif kind in _FTA:
                players[player].used += 0.44

        if team in on:
            if kind in _FGA:
                credit(team, "poss_off", "poss_def", 1.0)
            elif kind in _FTA:
                credit(team, "poss_off", "poss_def", 0.44)
            elif kind == "O":
                credit(team, "poss_off", "poss_def", -1.0)
            elif kind == "TO":
                credit(team, "poss_off", "poss_def", 1.0)

            if kind == "OUT":
                on[team].discard(player)
            elif kind == "IN" and player:
                on[team].add(player)
                player_team.setdefault(player, team)

    for team in (team_a, team_b):
        for code, (_, seconds) in sides[team]["players"].items():
            if abs(players[code].seconds - seconds) > tolerance:
                return None

    def pack(acc: _Acc) -> dict[str, Any]:
        return {
            "sec": round(acc.seconds, 1),
            "periods": [round(v, 1) for v in acc.by_period],
            "clutch": round(acc.clutch, 1),
            "pf": acc.pts_for,
            "pa": acc.pts_against,
            "po": round(acc.poss_off, 2),
            "pd": round(acc.poss_def, 2),
            "us": round(acc.used, 2),
        }

    return {
        "teams": {team: pack(acc) for team, acc in team_acc.items()},
        "players": {code: {**pack(acc), "team": player_team.get(code)} for code, acc in players.items() if acc.seconds > 0},
        "lineups": [
            {"team": team, "players": list(codes), **pack(acc)}
            for (team, codes), acc in lineups.items()
            if len(codes) == 5 and acc.seconds > 0
        ],
    }


def analyse_season(pbp: dict[int, dict[str, Any]], boxscores: dict[int, dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """analyse_game para todos los partidos con jugada a jugada y boxscore."""
    out: dict[int, dict[str, Any]] = {}
    for code, game in pbp.items():
        box = boxscores.get(int(code))
        if not box:
            continue
        result = analyse_game(game, box)
        if result is not None:
            out[int(code)] = result
    return out


def _per100(pts: float, poss: float) -> float | None:
    return round(100.0 * pts / poss, 1) if poss >= 1 else None


def player_court_stats(analysed: dict[int, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Por jugador: minutos por cuarto y en el final, y on/off por 100 posesiones.

    "Off" es lo que hizo su equipo en los partidos que él jugó, en los minutos
    en que estaba en el banquillo.
    """
    acc: dict[str, dict[str, Any]] = {}
    for game in analysed.values():
        teams = game["teams"]
        for code, line in game["players"].items():
            team = teams.get(line["team"]) or {}
            row = acc.setdefault(
                code,
                {"games": 0, "sec": 0.0, "periods": [0.0] * 5, "clutch": 0.0, "clutchGames": 0,
                 "on": [0.0, 0.0, 0.0, 0.0], "team": [0.0, 0.0, 0.0, 0.0], "used": 0.0},
            )
            row["games"] += 1
            row["sec"] += line["sec"]
            row["periods"] = [a + b for a, b in zip(row["periods"], line["periods"], strict=False)]
            row["clutch"] += line["clutch"]
            row["clutchGames"] += 1 if line["clutch"] > 0 else 0
            row["used"] += line.get("us", 0.0)
            row["on"] = [a + b for a, b in zip(row["on"], [line["pf"], line["pa"], line["po"], line["pd"]], strict=False)]
            row["team"] = [a + b for a, b in zip(row["team"], [team.get("pf", 0), team.get("pa", 0), team.get("po", 0), team.get("pd", 0)], strict=False)]

    out: dict[str, dict[str, Any]] = {}
    for code, row in acc.items():
        games = row["games"]
        on_pf, on_pa, on_po, on_pd = row["on"]
        off = [t - o for t, o in zip(row["team"], row["on"], strict=False)]
        on_poss = (on_po + on_pd) / 2
        off_poss = (off[2] + off[3]) / 2
        on_net = _per100(on_pf - on_pa, on_poss)
        off_net = _per100(off[0] - off[1], off_poss)
        out[code] = {
            "games": games,
            "minutes": round(row["sec"] / 60 / games, 1),
            "periodMinutes": [round(v / 60 / games, 1) for v in row["periods"]],
            "clutchMinutes": round(row["clutch"] / 60 / games, 1),
            "clutchGames": row["clutchGames"],
            # Uso: qué parte de las posesiones de su equipo con él en pista
            # acaba él (tiro, tiros libres o pérdida).
            "usage": round(row["used"] / on_po, 3) if on_po >= 5 else None,
            "onOff": {
                "onNet": on_net,
                "offNet": off_net,
                "onOrtg": _per100(on_pf, on_po),
                "onDrtg": _per100(on_pa, on_pd),
                "offOrtg": _per100(off[0], off[2]),
                "offDrtg": _per100(off[1], off[3]),
                "diff": round(on_net - off_net, 1) if on_net is not None and off_net is not None else None,
                "onPoss": round(on_poss, 1),
                "offPoss": round(off_poss, 1),
            },
        }
    return out


def team_lineups(analysed: dict[int, dict[str, Any]], *, top: int = 6, min_seconds: float = 120) -> dict[str, list[dict[str, Any]]]:
    """Los quintetos con más minutos de cada club."""
    acc: dict[tuple[str, tuple[str, ...]], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0.0, 0])
    for game in analysed.values():
        for lineup in game["lineups"]:
            key = (lineup["team"], tuple(sorted(lineup["players"])))
            row = acc[key]
            row[0] += lineup["sec"]
            row[1] += lineup["pf"]
            row[2] += lineup["pa"]
            row[3] += lineup["po"]
            row[4] += lineup["pd"]
            row[5] += 1
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (team, codes), (sec, pf, pa, poss_off, poss_def, games) in acc.items():
        if sec < min_seconds:
            continue
        poss = (poss_off + poss_def) / 2
        out[team].append(
            {
                "players": list(codes),
                "minutes": round(sec / 60, 1),
                "games": int(games),
                "pointsFor": int(pf),
                "pointsAgainst": int(pa),
                "possessions": round(poss, 1),
                "net": _per100(pf - pa, poss),
            }
        )
    return {team: sorted(rows, key=lambda r: -r["minutes"])[:top] for team, rows in out.items()}


# ---------------------------------------------------------------------------
# De dónde salen los puntos fantasy
# ---------------------------------------------------------------------------
#: (clave de salida, columna del game log, signo). Mismo orden que el baremo.
MIX_PARTS: list[tuple[str, str, int]] = [
    ("points", "points", 1),
    ("rebounds", "rebounds", 1),
    ("assists", "assists", 1),
    ("steals", "steals", 1),
    ("blocks", "blocks_favour", 1),
    ("foulsDrawn", "fouls_drawn", 1),
    ("winBonus", "fantasy_win_bonus", 1),
    ("missedFg", "missed_fg", -1),
    ("missedFt", "missed_ft", -1),
    ("turnovers", "turnovers", -1),
    ("foulsCommitted", "fouls_committed", -1),
    ("blocksAgainst", "blocks_against", -1),
]


def fantasy_mix(gamelog: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Media por partido jugado de cada acción, con su signo ya aplicado."""
    if gamelog.empty:
        return {}
    played = gamelog[gamelog["played"]]
    if played.empty:
        return {}
    grouped = played.groupby("person_code")
    means = grouped[[column for _, column, _ in MIX_PARTS]].mean()
    counts = grouped.size()
    out: dict[str, dict[str, float]] = {}
    for code, row in means.iterrows():
        parts = {key: round(sign * float(row[column]), 2) for key, column, sign in MIX_PARTS}
        out[str(code)] = {"games": int(counts.get(code, 0)), "parts": parts}
    return out


# ---------------------------------------------------------------------------
# Lo que concede cada club, por puesto
# ---------------------------------------------------------------------------
def allowed_by_position(gamelog: pd.DataFrame, positions: dict[str, str]) -> pd.DataFrame:
    """Puntos fantasy por partido que los rivales de cada club sacan por puesto.

    Una fila por (club, partido) sumando a los jugadores RIVALES de cada puesto,
    y luego la media por club. `positions`: person_code -> G/F/C.
    """
    if gamelog.empty:
        return pd.DataFrame(columns=["club_code", "games", "G", "F", "C", "all"])
    log = gamelog[gamelog["played"]].copy()
    log["pos"] = log["person_code"].map(positions)
    log = log[log["pos"].isin(["G", "F", "C"])]
    per_game = (
        log.groupby(["opponent_code", "game_code", "pos"])["fantasy_points"].sum().unstack("pos").fillna(0.0)
    )
    for position in ("G", "F", "C"):
        if position not in per_game.columns:
            per_game[position] = 0.0
    per_game["all"] = per_game[["G", "F", "C"]].sum(axis=1)
    table = per_game.groupby(level="opponent_code").agg(["mean", "size"])
    out = pd.DataFrame(
        {
            "club_code": table.index.astype(str),
            "games": table[("all", "size")].to_numpy(),
            **{pos: table[(pos, "mean")].to_numpy() for pos in ("G", "F", "C", "all")},
        }
    )
    return out.reset_index(drop=True)


def blend_allowed(current: pd.DataFrame, prior: pd.DataFrame, *, weight_games: float = 5.0) -> dict[str, dict[str, Any]]:
    """Encoge lo de esta temporada hacia la anterior (o hacia la media de la
    liga para quien no tiene año pasado), como la proyección de jugadores."""
    cols = ("G", "F", "C", "all")
    league_now = {c: float(current[c].mean()) for c in cols} if not current.empty else {}
    league_prior = {c: float(prior[c].mean()) for c in cols} if not prior.empty else {}
    league = league_now or league_prior
    if league_now and league_prior:
        # La media de la liga también se encoge: con 10 partidos es ruido.
        games_now = float(current["games"].mean())
        w = games_now / (games_now + weight_games)
        league = {c: w * league_now[c] + (1 - w) * league_prior[c] for c in cols}

    prior_index = prior.set_index("club_code") if not prior.empty else pd.DataFrame()
    clubs = set(current["club_code"]) | (set(prior["club_code"]) if not prior.empty else set())
    out: dict[str, dict[str, Any]] = {}
    for club in clubs:
        now = current[current["club_code"] == club]
        n = float(now["games"].iloc[0]) if not now.empty else 0.0
        base = (
            {c: float(prior_index.loc[club, c]) for c in cols}
            if not prior_index.empty and club in prior_index.index
            else dict(league)
        )
        values = {}
        for c in cols:
            cur = float(now[c].iloc[0]) if not now.empty else 0.0
            values[c] = round((n * cur + weight_games * base[c]) / (n + weight_games), 2) if base else None
        out[str(club)] = {"games": int(n), **values}
    # Índice frente a la media de la liga: 1,10 = concede un 10 % más.
    for row in out.values():
        row["index"] = {
            c: round(row[c] / league[c], 3) if row.get(c) and league.get(c) else None for c in cols
        }
    return {"clubs": out, "league": {c: round(v, 2) for c, v in league.items()}}


# ---------------------------------------------------------------------------
# Parciales por cuarto
# ---------------------------------------------------------------------------
def quarter_splits(games: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Media de puntos a favor y en contra en cada cuarto, por club."""
    acc: dict[str, dict[str, Any]] = {}
    for game in games:
        if not game.get("played"):
            continue
        for side, other in (("local", "road"), ("road", "local")):
            club = str(((game.get(side) or {}).get("club") or {}).get("code") or "")
            if not club:
                continue
            own = (game.get(side) or {}).get("partials") or {}
            opp = (game.get(other) or {}).get("partials") or {}
            row = acc.setdefault(club, {"games": 0, "for": [0.0] * 4, "against": [0.0] * 4, "overtimes": 0})
            row["games"] += 1
            for q in range(4):
                row["for"][q] += float(own.get(f"partials{q + 1}") or 0)
                row["against"][q] += float(opp.get(f"partials{q + 1}") or 0)
            if own.get("extraPeriods"):
                row["overtimes"] += 1
    return {
        club: {
            "games": row["games"],
            "for": [round(v / row["games"], 1) for v in row["for"]],
            "against": [round(v / row["games"], 1) for v in row["against"]],
            "overtimes": row["overtimes"],
        }
        for club, row in acc.items()
        if row["games"]
    }


# ---------------------------------------------------------------------------
# Precio
# ---------------------------------------------------------------------------
#: Coeficientes medidos en la J1 (26 sept 2026, 159 jugadores, R² 0,985):
#: plus = A·fpt + B·precio + C. Se usan si el ajuste del día no es fiable.
DEFAULT_PRICE_MODEL = {"a": 0.0400, "b": -0.0458, "c": 0.0273, "r2": 0.985, "n": 159, "source": "J1"}


def fit_price_model(frame: pd.DataFrame) -> dict[str, Any]:
    """Ajusta `plus ~ fp_ultima + precio` sobre quienes jugaron la última jornada.

    `frame` necesita las columnas `last_fp`, `quotation` y `plus`.
    """
    usable = frame.dropna(subset=["last_fp", "quotation", "plus"])
    usable = usable[usable["quotation"] > 0]
    if len(usable) < 40:
        return dict(DEFAULT_PRICE_MODEL)
    design = np.c_[usable["last_fp"], usable["quotation"], np.ones(len(usable))]
    coef, *_ = np.linalg.lstsq(design, usable["plus"], rcond=None)
    pred = design @ coef
    ss_res = float(((usable["plus"] - pred) ** 2).sum())
    ss_tot = float(((usable["plus"] - usable["plus"].mean()) ** 2).sum()) or 1.0
    r2 = 1 - ss_res / ss_tot
    if r2 < 0.8 or coef[0] <= 0:
        return dict(DEFAULT_PRICE_MODEL)
    return {
        "a": round(float(coef[0]), 5),
        "b": round(float(coef[1]), 5),
        "c": round(float(coef[2]), 5),
        "r2": round(r2, 3),
        "n": int(len(usable)),
        "source": "último snapshot",
    }


def break_even(model: dict[str, Any], quotation: float) -> float:
    """Puntos fantasy con los que el precio no se mueve."""
    return (-model["c"] - model["b"] * quotation) / model["a"]


def expected_change(model: dict[str, Any], projection: float, quotation: float) -> float:
    return model["a"] * projection + model["b"] * quotation + model["c"]


def prob_above(threshold: float, mean: float, sd: float) -> float:
    """P(X ≥ umbral) con X ~ Normal(media, sd)."""
    if sd <= 0:
        return 1.0 if mean >= threshold else 0.0
    z = (threshold - mean) / sd
    return 0.5 * math.erfc(z / math.sqrt(2))
