"""Pasadas las primeras jornadas, la temporada anterior no entra en ningún cálculo."""
from __future__ import annotations

import pandas as pd
import pytest

from efa import matchmodel
from efa.config import PRIOR_SEASON_ROUNDS, use_prior_season
from efa.projection import PRICE_RATE_WEIGHT, Params, price_references, project


def _log(players: dict[str, tuple[float, float]], games: int = 5) -> pd.DataFrame:
    """{jugador: (minutos, puntos)} en `games` partidos iguales."""
    return pd.DataFrame(
        [
            {"person_code": code, "game_code": g, "utc_date": f"2026-10-{g:02d}T18:00:00Z", "played": True,
             "minutes": minutes, "fantasy_points": points, "opponent_code": "X", "is_home": True, "round": g}
            for code, (minutes, points) in players.items()
            for g in range(1, games + 1)
        ]
    )


def _game(local: str, road: str, margin: int) -> dict:
    return {
        "played": True,
        "local": {"club": {"code": local}, "score": 80 + margin},
        "road": {"club": {"code": road}, "score": 80},
    }


def test_la_anterior_deja_de_contar_a_partir_del_umbral():
    assert use_prior_season(PRIOR_SEASON_ROUNDS - 1)
    assert not use_prior_season(PRIOR_SEASON_ROUNDS)


def test_referencia_por_precio_con_datos_de_esta_temporada():
    # 40 jugadores en los que precio, minutos y producción van a la par.
    players = {f"p{i}": (10.0 + i * 0.5, (10.0 + i * 0.5) * (0.5 + i * 0.01)) for i in range(40)}
    log = _log(players)
    table = pd.DataFrame(
        [{"person_code": f"p{i}", "quotation": 5.0 + i * 0.25} for i in range(40)]
        + [{"person_code": "nuevo", "quotation": 10.0}]
    )
    refs = price_references(table, log, {f"p{i}": "G" for i in range(40)} | {"nuevo": "G"})
    # El recién llegado, sin un solo partido, ya tiene referencia.
    assert refs["nuevo"]["minutes"] == pytest.approx(20.0, abs=0.01)
    by_price = 0.7
    by_position = (log["fantasy_points"].sum() / log["minutes"].sum())
    assert refs["nuevo"]["rate"] == pytest.approx(
        PRICE_RATE_WEIGHT * by_price + (1 - PRICE_RATE_WEIGHT) * by_position, abs=0.01
    )


def test_sin_anterior_los_minutos_son_los_suyos():
    log = _log({"A": (20.0, 20.0)})
    target = pd.DataFrame([{"person_code": "A", "opponent_code": "X", "is_home": True}])
    params = Params(opponent_weight=0, use_home=False)
    implied = {"A": {"minutes": 32.0, "rate": 0.5}}
    assert project(target, log, None, {"A": "G"}, params, implied_prior=implied)["minutes"].iloc[0] == pytest.approx(20.0)


def test_fuerza_de_equipo_encogida_hacia_el_valor_de_su_plantilla():
    clubs = [f"C{i}" for i in range(10)]
    # Cada club gana por lo mismo a su pareja: margen proporcional al valor.
    games = [g for i, c in enumerate(clubs[:5]) for g in [_game(c, clubs[9 - i], 10 - 2 * i)] * 4]
    values = {c: 10.0 + (4.5 - i) for i, c in enumerate(clubs)}
    plain = matchmodel.fit(games)
    anchored = matchmodel.fit(games, club_values=values)
    # A igualdad de partidos, el anclaje separa más a los clubes del extremo que encoger hacia 0.
    assert anchored.ratings["C0"] > plain.ratings["C0"]
    assert anchored.ratings["C9"] < plain.ratings["C9"]


def test_valor_de_plantilla_ignora_a_los_entrenadores():
    market = pd.DataFrame(
        [
            {"club_code": "A", "position": "Guard", "quotation": 10.0},
            {"club_code": "A", "position": "Center", "quotation": 20.0},
            {"club_code": "A", "position": "Head Coach", "quotation": 99.0},
        ]
    )
    assert matchmodel.roster_values(market) == {"A": pytest.approx(15.0)}
