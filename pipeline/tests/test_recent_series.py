"""La serie de partidos de la ficha lleva resultado y caja básica."""
import pandas as pd

from efa.metrics import recent_series


def _row(**over):
    base = {
        "person_code": "P1",
        "round": 1,
        "game_code": 1,
        "opponent_code": "BAS",
        "is_home": True,
        "minutes": 25.0,
        "fantasy_points": 20.0,
        "played": True,
    }
    base.update(over)
    return base


def test_lleva_resultado_y_caja_si_el_game_log_los_trae():
    log = pd.DataFrame([_row(team_won=True, margin=12, points=15.0, rebounds=6.0, assists=3.0)])
    game = recent_series(log)["P1"][0]
    assert game["won"] is True
    assert game["margin"] == 12
    assert (game["pts"], game["reb"], game["ast"]) == (15.0, 6.0, 3.0)


def test_sin_esas_columnas_la_serie_sigue_igual():
    game = recent_series(pd.DataFrame([_row()]))["P1"][0]
    assert set(game) == {"round", "opponent", "home", "minutes", "fp", "played"}
