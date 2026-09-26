"""Capa avanzada: zonas de tiro, quién está en pista, lo que concede cada club y
el modelo de precio."""
from __future__ import annotations

import pandas as pd
import pytest

from efa.advanced import (
    DEFAULT_PRICE_MODEL,
    allowed_by_position,
    analyse_game,
    blend_allowed,
    break_even,
    fit_price_model,
    player_court_stats,
    prob_above,
    quarter_splits,
    zone_of,
)


# ------------------------------------------------------------------ zonas
@pytest.mark.parametrize(
    ("x", "y", "value", "zone"),
    [
        (0, 30, 2, "rim"),
        (100, 300, 2, "paint"),
        (-400, 200, 2, "mid_l"),
        (0, 550, 2, "mid_c"),
        (400, 200, 2, "mid_r"),
        (-690, 20, 3, "c3_l"),
        (690, 20, 3, "c3_r"),
        (0, 720, 3, "ab3_c"),
        (-500, 500, 3, "ab3_l"),
        (500, 500, 3, "ab3_r"),
    ],
)
def test_zona_por_coordenadas(x, y, value, zone):
    assert zone_of(x, y, value) == zone


# --------------------------------------------------------------- en pista
def _box(starters_a, bench_a, starters_b, bench_b, seconds):
    def side(club, starters, bench):
        return {
            "players": [
                {
                    "player": {"person": {"code": code}, "club": {"code": club}},
                    "stats": {"startFive": code in starters, "timePlayed": seconds.get(code, 0)},
                }
                for code in [*starters, *bench]
            ]
        }

    return {"local": side("AAA", starters_a, bench_a), "road": side("BBB", starters_b, bench_b)}


def test_reconstruye_minutos_puntos_y_cambios():
    a = ["a1", "a2", "a3", "a4", "a5"]
    b = ["b1", "b2", "b3", "b4", "b5"]
    # 40 minutos: a5 sale en el minuto 20 por a6; A anota 2 antes y 3 después.
    seconds = {code: 2400 for code in a[:4] + b}
    seconds["a5"] = 1200
    seconds["a6"] = 1200
    events = [
        [1, 0, "BP", "", "", None, None],
        [1, 60, "2FGM", "AAA", "a1", 2, None],
        [2, 1200, "OUT", "AAA", "a5", None, None],
        [2, 1200, "IN", "AAA", "a6", None, None],
        [3, 1500, "3FGM", "AAA", "a6", 5, None],
        [4, 2400, "EG", "", "", None, None],
    ]
    game = analyse_game({"teamA": "AAA", "teamB": "BBB", "events": events}, _box(a, ["a6"], b, [], seconds))
    assert game is not None
    players = game["players"]
    assert players["a5"]["sec"] == pytest.approx(1200)
    assert players["a6"]["sec"] == pytest.approx(1200)
    assert players["a5"]["pf"] == 2 and players["a6"]["pf"] == 3
    assert players["b1"]["pa"] == 5
    # Los dos quintetos de A salen por separado.
    lineups_a = [lineup for lineup in game["lineups"] if lineup["team"] == "AAA"]
    assert len(lineups_a) == 2


def test_si_no_cuadra_con_el_boxscore_no_se_publica():
    a = ["a1", "a2", "a3", "a4", "a5"]
    b = ["b1", "b2", "b3", "b4", "b5"]
    seconds = {code: 2400 for code in a + b}
    seconds["a1"] = 600  # el boxscore dice 10 minutos; el jugada a jugada, 40
    events = [[1, 0, "BP", "", "", None, None], [4, 2400, "EG", "", "", None, None]]
    assert analyse_game({"teamA": "AAA", "teamB": "BBB", "events": events}, _box(a, [], b, [], seconds)) is None


def test_on_off_por_cien_posesiones():
    game = {
        "teams": {"AAA": {"pf": 100, "pa": 90, "po": 100, "pd": 100}},
        "players": {"x": {"team": "AAA", "sec": 1800, "periods": [450] * 4 + [0], "clutch": 0,
                          "pf": 80, "pa": 60, "po": 75, "pd": 75, "us": 15}},
    }
    stats = player_court_stats({1: game})["x"]
    assert stats["onOff"]["onNet"] == pytest.approx(100 * 20 / 75, abs=0.1)
    # Sin él: 20-30 en 25 posesiones.
    assert stats["onOff"]["offNet"] == pytest.approx(100 * -10 / 25, abs=0.1)
    assert stats["usage"] == pytest.approx(0.2)


# ------------------------------------------------------ lo que concede
def test_lo_que_concede_se_encoge_hacia_el_ano_pasado():
    log = pd.DataFrame(
        {
            "played": [True, True],
            "person_code": ["g1", "c1"],
            "opponent_code": ["AAA", "AAA"],
            "game_code": [1, 1],
            "fantasy_points": [40.0, 10.0],
        }
    )
    current = allowed_by_position(log, {"g1": "G", "c1": "C"})
    prior = pd.DataFrame([{"club_code": "AAA", "games": 30, "G": 20.0, "F": 30.0, "C": 20.0, "all": 70.0}])
    out = blend_allowed(current, prior)["clubs"]["AAA"]
    # 1 partido con 40 frente a una previa de 20 con peso 5: (40 + 5·20) / 6.
    assert out["G"] == pytest.approx((40 + 5 * 20) / 6, abs=0.01)


# ------------------------------------------------------------- cuartos
def test_parciales_por_cuarto():
    games = [
        {
            "played": True,
            "local": {"club": {"code": "AAA"}, "partials": {"partials1": 20, "partials2": 15, "partials3": 25, "partials4": 20}},
            "road": {"club": {"code": "BBB"}, "partials": {"partials1": 18, "partials2": 22, "partials3": 20, "partials4": 21}},
        }
    ]
    splits = quarter_splits(games)
    assert splits["AAA"]["for"] == [20, 15, 25, 20]
    assert splits["BBB"]["against"] == [20, 15, 25, 20]


# --------------------------------------------------------------- precio
def test_modelo_de_precio_recupera_los_coeficientes():
    rows = [{"last_fp": fp, "quotation": q} for fp in range(0, 35, 3) for q in (5, 8, 11, 14, 17)]
    frame = pd.DataFrame(rows)
    frame["plus"] = 0.04 * frame["last_fp"] - 0.046 * frame["quotation"] + 0.03
    model = fit_price_model(frame)
    assert model["a"] == pytest.approx(0.04, abs=1e-4)
    assert break_even(model, 10) == pytest.approx((0.46 - 0.03) / 0.04, abs=0.05)


def test_modelo_de_precio_sin_datos_usa_el_de_la_j1():
    model = fit_price_model(pd.DataFrame(columns=["last_fp", "quotation", "plus"]))
    assert model == DEFAULT_PRICE_MODEL


def test_probabilidad_de_superar_el_umbral():
    assert prob_above(10, 10, 5) == pytest.approx(0.5)
    assert prob_above(0, 10, 5) > 0.97
