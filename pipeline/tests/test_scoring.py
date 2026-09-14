"""La fórmula de puntuación es el corazón del proyecto: si está mal, todo lo
que se deriva de ella (proyecciones, valor, optimizador) está mal."""
from __future__ import annotations

import pytest

from efa.scoring import (
    coach_fantasy_points,
    lineup_score,
    player_fantasy_points,
    seconds_to_minutes,
)


def make_stats(**overrides):
    base = {
        "timePlayed": 1800.0,  # 30 minutos
        "points": 0.0,
        "totalRebounds": 0.0,
        "assistances": 0.0,
        "steals": 0.0,
        "turnovers": 0.0,
        "blocksFavour": 0.0,
        "blocksAgainst": 0.0,
        "foulsReceived": 0.0,
        "foulsCommited": 0.0,
        "fieldGoalsMadeTotal": 0.0,
        "fieldGoalsAttemptedTotal": 0.0,
        "freeThrowsMade": 0.0,
        "freeThrowsAttempted": 0.0,
    }
    base.update(overrides)
    return base


def test_cada_accion_positiva_suma_uno():
    for field in ("points", "totalRebounds", "assistances", "steals", "blocksFavour", "foulsReceived"):
        line = player_fantasy_points(make_stats(**{field: 1.0}), team_won=False)
        assert line.base == 1.0, field


def test_cada_accion_negativa_resta_uno():
    for field in ("turnovers", "blocksAgainst", "foulsCommited"):
        line = player_fantasy_points(make_stats(**{field: 1.0}), team_won=False)
        assert line.base == -1.0, field


def test_tiros_fallados_restan():
    stats = make_stats(
        points=10.0,
        fieldGoalsMadeTotal=5.0,
        fieldGoalsAttemptedTotal=12.0,   # 7 fallados
        freeThrowsMade=0.0,
        freeThrowsAttempted=3.0,         # 3 fallados
    )
    line = player_fantasy_points(stats, team_won=False)
    assert line.base == 10.0 - 7 - 3


def test_linea_completa_realista():
    # 18 pts (7/13 TC, 4/5 TL), 6 reb, 4 as, 2 rob, 3 perd, 1 tap, 5 faltas rec, 2 com.
    stats = make_stats(
        points=18.0,
        totalRebounds=6.0,
        assistances=4.0,
        steals=2.0,
        turnovers=3.0,
        blocksFavour=1.0,
        blocksAgainst=0.0,
        foulsReceived=5.0,
        foulsCommited=2.0,
        fieldGoalsMadeTotal=7.0,
        fieldGoalsAttemptedTotal=13.0,
        freeThrowsMade=4.0,
        freeThrowsAttempted=5.0,
    )
    expected = 18 + 6 + 4 + 2 - 3 + 1 - 0 + 5 - 2 - 6 - 1
    line = player_fantasy_points(stats, team_won=False)
    assert line.base == expected
    assert line.total == expected


def test_bonus_de_victoria_es_diez_por_ciento():
    stats = make_stats(points=20.0, fieldGoalsMadeTotal=10.0, fieldGoalsAttemptedTotal=10.0)
    won = player_fantasy_points(stats, team_won=True)
    lost = player_fantasy_points(stats, team_won=False)
    assert lost.total == 20.0
    assert won.win_bonus == pytest.approx(2.0)
    assert won.total == pytest.approx(22.0)


def test_sin_minutos_no_hay_bonus_ni_partido_jugado():
    line = player_fantasy_points(make_stats(timePlayed=0.0), team_won=True)
    assert line.played is False
    assert line.win_bonus == 0.0


def test_minutos_se_convierten_desde_segundos():
    assert seconds_to_minutes(1800.0) == 30.0
    assert seconds_to_minutes(0.0) == 0.0


@pytest.mark.parametrize(
    ("margin", "overtime", "expected"),
    [
        (5, False, 10),
        (15, False, 20),
        (25, False, 25),
        (-5, False, -5),
        (-15, False, -10),
        (-25, False, -20),
        (3, True, 10),
        (-3, True, -5),
        (21, False, 25),
        (-21, False, -20),
    ],
)
def test_puntuacion_del_entrenador(margin, overtime, expected):
    assert coach_fantasy_points(margin, overtime=overtime) == expected


def test_alineacion_aplica_capitan_y_banquillo():
    starters = [20.0, 10.0, 10.0, 10.0, 10.0]
    bench = [8.0, 8.0]
    # capitán x2 sobre el primero, banquillo al 50%
    assert lineup_score(starters, bench, captain_index=0) == pytest.approx(20 * 2 + 40 + 8)


def test_alineacion_sin_capitan():
    assert lineup_score([10.0, 10.0], [], captain_index=None) == pytest.approx(20.0)
