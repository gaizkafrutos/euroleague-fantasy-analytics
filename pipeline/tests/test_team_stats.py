"""Índices de equipo, calendario publicado y colores de club."""
from __future__ import annotations

import pandas as pd
import pytest

from efa.metrics import schedule_difficulty, team_box_stats


def make_games():
    """Dos partidos: MAD-BAR y BAR-MAD, más tres de calendario futuro."""
    jugados = [
        {"gameCode": 1, "round": 1, "utcDate": "2026-01-01",
         "local": {"club": {"code": "MAD"}}, "road": {"club": {"code": "BAR"}}},
        {"gameCode": 2, "round": 2, "utcDate": "2026-01-08",
         "local": {"club": {"code": "BAR"}}, "road": {"club": {"code": "MAD"}}},
    ]
    return jugados


def total(points, fga, fgm, fg3a, fg3m, fta, orb, drb, tov, ast):
    return {
        "points": points, "fieldGoalsAttemptedTotal": fga, "fieldGoalsMadeTotal": fgm,
        "fieldGoalsAttempted3": fg3a, "fieldGoalsMade3": fg3m, "freeThrowsAttempted": fta,
        "offensiveRebounds": orb, "defensiveRebounds": drb, "turnovers": tov,
        "assistances": ast,
    }


def make_boxscores():
    return {
        1: {"local": {"total": total(90, 60, 33, 20, 8, 15, 10, 25, 12, 20)},
            "road": {"total": total(80, 62, 30, 22, 7, 12, 8, 24, 14, 16)}},
        2: {"local": {"total": total(70, 58, 26, 18, 6, 10, 7, 23, 16, 14)},
            "road": {"total": total(85, 61, 32, 21, 9, 14, 11, 26, 11, 19)}},
    }


def test_balance_y_ritmo():
    stats = team_box_stats(make_boxscores(), make_games()).set_index("club_code")
    # MAD gana los dos; BAR pierde los dos.
    assert stats.loc["MAD", "wins"] == 2
    assert stats.loc["MAD", "losses"] == 0
    assert stats.loc["BAR", "wins"] == 0
    assert stats.loc["MAD", "box_games"] == 2
    # Ritmo positivo y coherente con el orden de magnitud del baloncesto.
    assert 50 < stats.loc["MAD", "pace"] < 110


def test_el_ataque_de_uno_es_la_defensa_del_otro():
    stats = team_box_stats(make_boxscores(), make_games()).set_index("club_code")
    assert stats.loc["MAD", "ppg"] == stats.loc["BAR", "papg"]
    assert stats.loc["MAD", "net_rating"] > 0
    assert stats.loc["BAR", "net_rating"] < 0


def test_un_club_sin_partidos_no_aparece():
    """Un recién llegado tiene que poder decir 'sin histórico', no pintar ceros."""
    stats = team_box_stats(make_boxscores(), make_games())
    assert set(stats["club_code"]) == {"MAD", "BAR"}
    assert "BES" not in set(stats["club_code"])


def test_sin_datos_devuelve_tabla_vacia():
    assert team_box_stats({}, []).empty
    assert team_box_stats(make_boxscores(), []).empty


def test_publica_cinco_partidos_pero_calcula_con_tres():
    games = [
        {"gameCode": i, "round": i, "utcDate": f"2026-02-{i:02d}",
         "local": {"club": {"code": "MAD"}}, "road": {"club": {"code": "BAR"}}}
        for i in range(1, 8)
    ]
    strength = pd.DataFrame(
        [{"club_code": "MAD", "net_rating": 5.0}, {"club_code": "BAR", "net_rating": -5.0}]
    )
    out = schedule_difficulty(games, strength, from_round=1, horizon=3, publish=5)
    fixtures = out.set_index("club_code").loc["MAD", "fixtures"]
    assert len(fixtures) == 5

    # El índice solo mira los tres primeros: publicar más no puede cambiarlo.
    tres = schedule_difficulty(games, strength, from_round=1, horizon=3, publish=3)
    assert out.set_index("club_code").loc["MAD", "raw_difficulty"] == (
        tres.set_index("club_code").loc["MAD", "raw_difficulty"]
    )


def test_los_colores_de_club_se_leen_del_csv():
    from efa.build import load_club_colors

    colors = load_club_colors()
    if not colors:            # el fichero es opcional
        return
    assert len(colors) == 20
    for entry in colors.values():
        assert entry["halo"].startswith("#")
        assert entry["statDark"].startswith("#")
        assert entry["statLight"].startswith("#")


def test_rating_de_equipo_encogido_hacia_la_temporada_anterior():
    """Tras la J1 el calendario salía del margen de un único partido."""
    import pandas as pd

    from efa.metrics import team_strength

    games = [{
        "played": True,
        "local": {"club": {"code": "PAN"}, "score": 91},
        "road": {"club": {"code": "NEW"}, "score": 72},
    }]
    prior = pd.DataFrame([
        {"club_code": "PAN", "offense": 84.0, "defense": 80.0, "win_rate": 0.6, "net_rating": 4.0, "games": 34},
    ])
    raw = team_strength(games).set_index("club_code")
    shrunk = team_strength(games, prior=prior).set_index("club_code")
    assert raw.loc["PAN", "net_rating"] == 19.0
    # 1 partido frente a k=6: pesa 1/7 lo de ahora.
    assert shrunk.loc["PAN", "net_rating"] == pytest.approx((19 + 6 * 4) / 7, abs=0.05)
    # Un recién llegado sin año pasado se queda con lo suyo.
    assert shrunk.loc["NEW", "net_rating"] == raw.loc["NEW", "net_rating"]
    assert "anterior" in shrunk["source"].iloc[0]
