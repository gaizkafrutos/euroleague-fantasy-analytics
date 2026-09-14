"""Construcción del game log: una fila por jugador y partido.

Toma los boxscores oficiales y aplica la fórmula de puntuación de Fantaking
para reconstruir los puntos fantasy reales de cada actuación. Es la base de
todo lo demás: forma reciente, varianza, tendencia de minutos y proyecciones.
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from efa.scoring import coach_fantasy_points, player_fantasy_points, seconds_to_minutes

log = logging.getLogger(__name__)

GAMELOG_COLUMNS = [
    "game_code",
    "round",
    "phase",
    "utc_date",
    "person_code",
    "name",
    "club_code",
    "opponent_code",
    "is_home",
    "team_won",
    "margin",
    "minutes",
    "played",
    "started",
    "fantasy_base",
    "fantasy_win_bonus",
    "fantasy_points",
    "points",
    "rebounds",
    "assists",
    "steals",
    "turnovers",
    "blocks_favour",
    "blocks_against",
    "fouls_drawn",
    "fouls_committed",
    "missed_fg",
    "missed_ft",
    "plus_minus",
    "valuation",
]


def _game_index(games: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(g["gameCode"]): g for g in games if g.get("gameCode") is not None}


def _has_overtime(game: dict[str, Any] | None) -> bool:
    if not game:
        return False
    for side in ("local", "road"):
        partials = (game.get(side) or {}).get("partials") or {}
        if partials.get("extraPeriods"):
            return True
    return False


def build_gamelog(
    boxscores: dict[int, dict[str, Any]],
    games: list[dict[str, Any]],
) -> pd.DataFrame:
    """DataFrame con una fila por (jugador, partido)."""
    index = _game_index(games)
    rows: list[dict[str, Any]] = []

    for game_code, payload in sorted(boxscores.items()):
        game = index.get(game_code)
        local_score = float((payload.get("local", {}).get("total") or {}).get("points", 0))
        road_score = float((payload.get("road", {}).get("total") or {}).get("points", 0))

        sides = (
            ("local", local_score, road_score, True),
            ("road", road_score, local_score, False),
        )
        for side, own_score, rival_score, is_home in sides:
            block = payload.get(side) or {}
            own_club = _side_club(game, side)
            rival_club = _side_club(game, "road" if side == "local" else "local")
            margin = int(own_score - rival_score)
            team_won = margin > 0

            for entry in block.get("players", []):
                person = (entry.get("player") or {}).get("person") or {}
                stats = entry.get("stats") or {}
                line = player_fantasy_points(stats, team_won=team_won)

                rows.append(
                    {
                        "game_code": game_code,
                        "round": int(game["round"]) if game and game.get("round") else None,
                        "phase": (game.get("phaseType") or {}).get("code") if game else None,
                        "utc_date": game.get("utcDate") if game else None,
                        "person_code": str(person.get("code", "")),
                        "name": person.get("name", ""),
                        "club_code": own_club,
                        "opponent_code": rival_club,
                        "is_home": is_home,
                        "team_won": team_won,
                        "margin": margin,
                        "minutes": line.minutes,
                        "played": line.played,
                        "started": bool(stats.get("startFive")),
                        "fantasy_base": round(line.base, 2),
                        "fantasy_win_bonus": round(line.win_bonus, 2),
                        "fantasy_points": round(line.total, 2),
                        "points": float(stats.get("points", 0)),
                        "rebounds": float(stats.get("totalRebounds", 0)),
                        "assists": float(stats.get("assistances", 0)),
                        "steals": float(stats.get("steals", 0)),
                        "turnovers": float(stats.get("turnovers", 0)),
                        "blocks_favour": float(stats.get("blocksFavour", 0)),
                        "blocks_against": float(stats.get("blocksAgainst", 0)),
                        "fouls_drawn": float(stats.get("foulsReceived", 0)),
                        "fouls_committed": float(stats.get("foulsCommited", 0)),
                        "missed_fg": max(
                            float(stats.get("fieldGoalsAttemptedTotal", 0))
                            - float(stats.get("fieldGoalsMadeTotal", 0)),
                            0.0,
                        ),
                        "missed_ft": max(
                            float(stats.get("freeThrowsAttempted", 0))
                            - float(stats.get("freeThrowsMade", 0)),
                            0.0,
                        ),
                        "plus_minus": float(stats.get("plusMinus", 0)),
                        "valuation": float(stats.get("valuation", 0)),
                    }
                )

    if not rows:
        return pd.DataFrame(columns=GAMELOG_COLUMNS)

    frame = pd.DataFrame(rows)
    return frame[[c for c in GAMELOG_COLUMNS if c in frame.columns]]


def build_coach_gamelog(
    boxscores: dict[int, dict[str, Any]],
    games: list[dict[str, Any]],
) -> pd.DataFrame:
    """Una fila por (entrenador, partido) con su puntuación fantasy."""
    index = _game_index(games)
    rows: list[dict[str, Any]] = []

    for game_code, payload in sorted(boxscores.items()):
        game = index.get(game_code)
        overtime = _has_overtime(game)
        local_score = float((payload.get("local", {}).get("total") or {}).get("points", 0))
        road_score = float((payload.get("road", {}).get("total") or {}).get("points", 0))

        for side, own, rival in (("local", local_score, road_score), ("road", road_score, local_score)):
            coach = (payload.get(side) or {}).get("coach") or {}
            if not coach.get("code"):
                continue
            margin = int(own - rival)
            rows.append(
                {
                    "game_code": game_code,
                    "round": int(game["round"]) if game and game.get("round") else None,
                    "utc_date": game.get("utcDate") if game else None,
                    "person_code": str(coach.get("code")),
                    "name": coach.get("name", ""),
                    "club_code": _side_club(game, side),
                    "margin": margin,
                    "overtime": overtime,
                    "fantasy_points": coach_fantasy_points(margin, overtime=overtime),
                }
            )

    return pd.DataFrame(rows)


def _side_club(game: dict[str, Any] | None, side: str) -> str | None:
    if not game:
        return None
    return ((game.get(side) or {}).get("club") or {}).get("code")


def team_minutes_share(gamelog: pd.DataFrame) -> pd.DataFrame:
    """Porcentaje de los minutos de su equipo que juega cada jugador, por partido.

    Es una señal de rol más limpia que los minutos absolutos: 22 minutos en un
    partido con prórroga no valen lo mismo que 22 en uno normal.
    """
    if gamelog.empty:
        return gamelog.assign(minutes_share=[])
    totals = (
        gamelog.groupby(["game_code", "club_code"])["minutes"].transform("sum").replace(0, pd.NA)
    )
    out = gamelog.copy()
    out["minutes_share"] = (out["minutes"] / totals).astype(float).fillna(0.0)
    return out


__all__ = [
    "build_gamelog",
    "build_coach_gamelog",
    "team_minutes_share",
    "seconds_to_minutes",
    "GAMELOG_COLUMNS",
]
