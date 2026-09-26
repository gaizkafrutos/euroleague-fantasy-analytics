"""Proyección v2 y modelo de partido."""
from __future__ import annotations

import math

import pandas as pd
import pytest

from efa import matchmodel
from efa.projection import Params, player_state, project


def _log(rows):
    return pd.DataFrame(
        [
            {"person_code": p, "game_code": g, "utc_date": f"2026-10-{g:02d}T18:00:00Z", "played": m > 0,
             "minutes": m, "fantasy_points": fp, "opponent_code": opp, "is_home": home, "round": g}
            for p, g, m, fp, opp, home in rows
        ]
    )


def test_estado_del_jugador_y_minutos_recientes():
    log = _log([("A", 1, 10, 5, "X", True), ("A", 2, 30, 30, "Y", False), ("A", 3, 0, 0, "Z", True)])
    state = player_state(log, half_life=3)
    assert state.loc["A", "n"] == 2  # el DNP no cuenta como jugado
    assert state.loc["A", "min_sum"] == 40
    # La media exponencial pesa más el último partido jugado.
    assert 20 < state.loc["A", "min_ewm"] < 30


def test_sin_historia_usa_el_ano_pasado_y_encoge_la_produccion():
    prior = _log([("A", g, 20, 20, "X", True) for g in range(1, 11)])  # 1,0 pts/min, 20 min
    now = _log([("A", 11, 20, 40, "X", True)])  # un partidazo: 2,0 pts/min
    target = pd.DataFrame([{"person_code": "A", "opponent_code": None, "is_home": True}])
    params = Params(opponent_weight=0, use_home=False, rate_prior_minutes=100)
    solo_prior = project(target, now.iloc[0:0], prior, {"A": "G"}, params)
    assert solo_prior["projection"].iloc[0] == pytest.approx(20.0)
    con_uno = project(target, now, prior, {"A": "G"}, params)
    # Producción: (40 + 100·1,0) / (20 + 100) = 1,167; minutos 20.
    assert con_uno["rate"].iloc[0] == pytest.approx(140 / 120, abs=1e-3)
    assert con_uno["projection"].iloc[0] == pytest.approx(20 * 140 / 120, abs=0.05)


def test_modelo_de_partido():
    games = [
        {"played": True, "local": {"club": {"code": "A"}, "score": 90}, "road": {"club": {"code": "B"}, "score": 70}},
        {"played": True, "local": {"club": {"code": "B"}, "score": 80}, "road": {"club": {"code": "A"}, "score": 85}},
    ]
    model = matchmodel.fit(games)
    assert model.ratings["A"] > 0 > model.ratings["B"]
    assert model.win_prob("A", "B", True) > 0.5 > model.win_prob("B", "A", False)
    assert model.win_prob("A", "B", True) + model.win_prob("B", "A", False) == pytest.approx(1.0)
    # Puntos del entrenador: acotados entre -20 y +25 y mejores para el favorito.
    fav, dog = model.coach_points("A", "B", True), model.coach_points("B", "A", False)
    assert -20 <= dog < fav <= 25


def test_puntos_del_entrenador_por_margen():
    assert matchmodel.coach_points_actual(5, False) == 10
    assert matchmodel.coach_points_actual(15, False) == 20
    assert matchmodel.coach_points_actual(25, False) == 25
    assert matchmodel.coach_points_actual(-5, False) == -5
    assert matchmodel.coach_points_actual(-15, False) == -10
    assert matchmodel.coach_points_actual(-30, False) == -20
    assert matchmodel.coach_points_actual(3, True) == 10 and matchmodel.coach_points_actual(-3, True) == -5


def test_esperanza_del_entrenador_con_margen_nulo():
    model = matchmodel.MatchModel(ratings={}, home=0.0, sd=12.0)
    # Simétrico: gana tanto como pierde, pero ganar da más puntos que resta perder.
    expected = model.coach_points("A", "B", True)
    assert 0 < expected < 10
    assert math.isclose(model.win_prob("A", "B", True), 0.5)
