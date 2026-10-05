"""Casos verificados en la auditoría tras la J3 (5 de octubre de 2026).

Cada uno reproduce un dato real contrastado con el Fantasy oficial o con la
web de la Euroliga, o un fallo encontrado entonces, para que no vuelva.
"""
from __future__ import annotations

import json

import pandas as pd
import pytest

from efa.scoring import player_fantasy_points


# ---------------------------------------------------------------------------
# Baremo: actuaciones reales de la 2026-27, cuadradas con el juego al decimal
# ---------------------------------------------------------------------------
def _line(pts, reb, ast, stl, tov, blk, blka, fd, pf, fga, fgm, fta, ftm, secs=1500):
    return {
        "points": pts, "totalRebounds": reb, "assistances": ast, "steals": stl,
        "turnovers": tov, "blocksFavour": blk, "blocksAgainst": blka,
        "foulsReceived": fd, "foulsCommited": pf,
        "fieldGoalsAttemptedTotal": fga, "fieldGoalsMadeTotal": fgm,
        "freeThrowsAttempted": fta, "freeThrowsMade": ftm, "timePlayed": secs,
    }


@pytest.mark.parametrize(
    ("label", "stats", "won", "expected"),
    [
        # Intentos y aciertos de tiro elegidos para dar los fallos reales de cada línea.
        ("Bryant J3, gana HTA", _line(22, 13, 7, 1, 1, 0, 0, 9, 1, 15, 7, 8, 6), True, 44.0),
        ("C. Jones J1, gana PAR", _line(20, 4, 10, 0, 0, 0, 0, 5, 1, 12, 7, 2, 2), True, 36.3),
        ("Vezenkov J3, pierde OLY", _line(20, 6, 0, 1, 0, 0, 0, 2, 0, 13, 7, 4, 4), False, 23.0),
        ("Shorts J1, gana PAM", _line(26, 1, 2, 1, 2, 0, 1, 5, 3, 18, 9, 6, 6), True, 22.0),
        ("Núñez J3, gana BAR con base negativa", _line(0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 148), True, -0.9),
        ("Jeffries J1, pierde BES", _line(0, 0, 1, 0, 1, 1, 0, 0, 3, 1, 0, 0, 0, 327), False, -3.0),
    ],
)
def test_actuaciones_reales_2026(label, stats, won, expected):
    assert player_fantasy_points(stats, team_won=won).total == pytest.approx(expected), label


# ---------------------------------------------------------------------------
# Precio pendiente: `plus` es la variación ACUMULADA, no la de la jornada
# ---------------------------------------------------------------------------
def _game(code, round_, when, local, road, played=True):
    return {
        "gameCode": code, "round": round_, "utcDate": when, "played": played,
        "local": {"club": {"code": local}}, "road": {"club": {"code": road}},
    }


def _snap(when, rows):
    return pd.DataFrame(
        [{"fantaking_id": i, "quotation": q, "plus": p, "captured_at": pd.Timestamp(when)} for i, q, p in rows]
    )


def test_precio_pendiente_usa_plus_acumulado():
    """Carlik Jones, J3: salió a 13,6; tras la J2 vale 15,0 (plus +1,4). A mitad de
    la J3, con su partido ya jugado, el juego dice plus +1,3: su precio al cerrar
    será 13,6 + 1,3 = 14,9, no 15,0 + 1,3 = 16,3 como calculaba la web."""
    from efa.advanced_build import pending_prices, price_freshness

    games = [
        _game(1, 1, "2026-09-25T18:45:00Z", "PAR", "MIL"),
        _game(2, 2, "2026-09-29T18:45:00Z", "PRS", "PAR"),
        _game(3, 3, "2026-10-02T18:00:00Z", "MUN", "PAR"),
        _game(4, 3, "2026-10-02T18:30:00Z", "BAS", "MIL"),
    ]
    filler = [(100 + i, 10.0, 0.0) for i in range(25)]
    history = pd.concat([
        _snap("2026-09-24T12:00Z", [(3791, 13.6, 0.0), *filler]),
        _snap("2026-10-01T07:21Z", [(3791, 15.0, 1.4), *filler]),
        # Jornada terminada, sin aplicar: plus cambia, la cotización no.
        _snap("2026-10-02T23:07Z", [(3791, 15.0, 1.3), *[(i, q, 0.3) for i, q, _ in filler]]),
    ])
    market = history[history["captured_at"] == history["captured_at"].max()]
    fresh = price_freshness(history, games)
    assert fresh["stale"]
    records = [{"id": 3791, "personCode": "013369", "club": "PAR", "price": 15.0, "isCoach": False}]
    model = {"a": 0.04, "b": -0.0458, "c": 0.0273}
    pending_prices(records, market, pd.DataFrame(), games, model, fresh, history=history)
    assert records[0]["pricePending"] == 14.9
    assert records[0]["pricePendingSource"] == "juego"


def test_ultima_variacion_ignora_capturas_sin_cambio_de_precio():
    """A mitad de jornada se guardan capturas en las que solo cambia `fpt`: la
    última variación tiene que seguir siendo la de la jornada anterior."""
    from efa.metrics import price_history

    snaps = pd.DataFrame({
        "fantaking_id": [1, 1, 1],
        "quotation": [17.6, 18.0, 18.0],
        "captured_at": pd.to_datetime(["2026-09-28", "2026-10-01", "2026-10-02"], utc=True),
    })
    assert price_history(snaps).iloc[0]["price_delta_last"] == pytest.approx(0.4)


# ---------------------------------------------------------------------------
# Modelo de precio: se ajusta con la variación real de cada jornada cerrada
# ---------------------------------------------------------------------------
def test_modelo_de_precio_con_variacion_real_de_la_jornada():
    from efa.advanced import fit_price_model
    from efa.advanced_build import round_price_frame

    games = [_game(1, 1, "2026-09-24T18:00:00Z", "OLY", "PAR")]
    rng = range(60)
    pre = _snap("2026-09-24T12:00Z", [(i, 5.0 + i * 0.2, 0.0) for i in rng])

    def change(i):
        return round(0.04 * (i % 30) - 0.0458 * (5.0 + i * 0.2) + 0.03, 1)

    post = _snap("2026-09-26T07:00Z", [(i, round(5.0 + i * 0.2 + change(i), 1), change(i)) for i in rng])
    history = pd.concat([pre, post])
    crosswalk = pd.DataFrame({"fantaking_id": list(rng), "person_code": [f"P{i}" for i in rng]})
    log = pd.DataFrame({
        "person_code": [f"P{i}" for i in rng], "round": 1, "played": True,
        "fantasy_points": [float(i % 30) for i in rng],
    })
    frame = round_price_frame(history, crosswalk, log, games)
    assert len(frame) >= 50 and set(frame["round"]) == {1}
    model = fit_price_model(frame, source="J1")
    assert model["source"] == "J1"
    assert model["a"] == pytest.approx(0.04, abs=0.005)


# ---------------------------------------------------------------------------
# Probabilidad de jugar, calibrada con J2–J3
# ---------------------------------------------------------------------------
def test_probabilidad_de_duda_calibrada():
    from efa.build import PLAY_PROB

    assert PLAY_PROB["doubt"] <= 0.35  # observado: 14 de 57 en J2–J3
    assert PLAY_PROB["out"] == 0.0


def test_nunca_convocado_casi_no_juega():
    """Sin aparecer en ninguna convocatoria con su club ya jugando, ya no parte
    del 57 %: en J2–J3 jugó el 5 %."""
    from efa.build import play_share

    played = pd.Series([0.0, 0.0, 2.0])
    appeared = pd.Series([0.0, 2.0, 2.0])   # nunca convocado · dos DNP · fijo
    club = pd.Series([3.0, 3.0, 2.0])
    share = play_share(played, appeared, club)
    assert share.iloc[0] < 0.1
    assert share.iloc[1] == pytest.approx(0.4)
    assert share.iloc[2] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Próximo partido: con la jornada a medias, el primero SIN jugar
# ---------------------------------------------------------------------------
def test_proximo_partido_salta_el_ya_jugado():
    from efa.projection import next_fixtures

    games = [
        _game(1, 4, "2026-10-07T18:45:00Z", "PRS", "ASV", played=True),
        _game(2, 4, "2026-10-09T18:30:00Z", "BAR", "ZAL", played=False),
        _game(3, 5, "2026-10-13T18:00:00Z", "ASV", "BAR", played=False),
    ]
    fixtures = next_fixtures(games, 4)
    assert fixtures["ASV"] == ("BAR", True)      # ya jugó la J4: pasa a la J5
    assert fixtures["BAR"] == ("ZAL", True)
    assert "PRS" not in fixtures


# ---------------------------------------------------------------------------
# Backtest de lo publicado
# ---------------------------------------------------------------------------
def test_evaluacion_de_lo_publicado_cuenta_los_que_no_juegan_como_cero():
    from efa.published import evaluate_round

    games = [_game(1, 2, "2026-09-29T18:00:00Z", "OLY", "PAR")]
    prediction = {
        "round": 2,
        "players": [
            {"id": 1, "personCode": "A", "isCoach": False, "price": 15.0, "projectedFp": 20.0,
             "projectedIfPlays": 20.0, "playProb": 1.0, "availability": None, "neverDressed": False},
            {"id": 2, "personCode": "B", "isCoach": False, "price": 6.0, "projectedFp": 5.0,
             "projectedIfPlays": 10.0, "playProb": 0.5, "availability": "doubt", "neverDressed": False},
        ],
    }
    log = pd.DataFrame({
        "person_code": ["A", "A"], "round": [1, 2], "played": [True, True], "fantasy_points": [18.0, 22.0],
    })
    result = evaluate_round(prediction, log, games)
    assert result["n"] == 2
    assert result["model"]["mae"] == pytest.approx((2.0 + 5.0) / 2)
    assert result["playProb"]["doubt"] == {"n": 1, "predicted": 0.5, "real": 0.0}


def test_no_se_guarda_la_prediccion_con_la_jornada_empezada(tmp_path, monkeypatch):
    from datetime import datetime, timezone

    from efa import published

    monkeypatch.setattr(published, "PREDICTIONS_DIR", tmp_path)
    games = [_game(1, 4, "2026-10-07T18:45:00Z", "PRS", "ASV", played=False)]
    record = {"id": 1, "personCode": "A", "isCoach": False, "price": 5.0, "projectedFp": 3.0}
    before = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
    after = datetime(2026, 10, 7, 19, tzinfo=timezone.utc)
    assert published.archive_predictions([record], games, 4, now=after) is None
    assert published.archive_predictions([record], games, 4, now=before) == "R04.json"
    saved = json.loads((tmp_path / "R04.json").read_text(encoding="utf-8"))
    assert saved["round"] == 4 and saved["players"][0]["projectedFp"] == 3.0
