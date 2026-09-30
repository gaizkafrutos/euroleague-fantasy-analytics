"""Captura de precios: forma de los datos y protección del histórico."""
from __future__ import annotations

import pandas as pd
import pytest

from efa.ingest.prices import market_to_frame

COLUMNS = [
    "rank", "name", "position", "team", "fpt", "quotation", "plus",
    "pts", "reb", "ast", "stl", "tov", "blk", "blka", "fd", "pf",
    "fg_missed", "ft_missed",
]


def row(name, team, position, fpt, quotation):
    return [1, name, position, team, fpt, quotation, 0.0, 12.0, 4.0, 3.0, 1.0, 2.0,
            0.0, 0.0, 3.0, 2.0, 5.0, 1.0]


@pytest.fixture
def market():
    players = [
        {"id": 101, "row": row("Vezenkov, Sasha", "Olympiacos", "F", 23.8, 18.5)},
        {"id": 102, "row": row("Larkin, Shane", "Fenerbahce", "G", 17.2, 14.0)},
    ]
    return market_to_frame(COLUMNS, players, "2026-10-01T07:00:00+00:00")


def test_convierte_filas_en_columnas_tipadas(market):
    assert list(market["fantaking_id"]) == [101, 102]
    assert market["quotation"].tolist() == [18.5, 14.0]
    assert pd.api.types.is_numeric_dtype(market["quotation"])
    assert pd.api.types.is_numeric_dtype(market["fpt"])


def test_los_campos_de_texto_no_se_convierten_a_numero(market):
    assert market["name"].iloc[0] == "Vezenkov, Sasha"
    assert market["team"].iloc[1] == "Fenerbahce"
    assert market["position"].iloc[0] == "F"


def test_las_columnas_de_identidad_van_primero(market):
    assert list(market.columns)[:4] == ["fantaking_id", "name", "team", "position"]
    assert list(market.columns)[-1] == "captured_at"


def test_valores_no_numericos_se_vuelven_nulos():
    players = [{"id": 1, "row": row("X, Y", "Real Madrid", "C", "n/d", 9.0)}]
    frame = market_to_frame(COLUMNS, players, "2026-10-01T07:00:00+00:00")
    assert pd.isna(frame["fpt"].iloc[0])
    assert frame["quotation"].iloc[0] == 9.0


def test_el_snapshot_borra_los_datos_de_demostracion(monkeypatch, tmp_path):
    """Mezclar precios inventados con reales corrompería el histórico entero."""
    from efa import demo
    from efa.ingest import prices

    calls: dict[str, int] = {"clear": 0}
    monkeypatch.setattr(demo, "has_demo_data", lambda: True)
    monkeypatch.setattr(demo, "clear", lambda: calls.__setitem__("clear", calls["clear"] + 1) or 3)
    monkeypatch.setattr(prices, "RAW_PRICES_DIR", tmp_path)
    monkeypatch.setattr(prices, "INDEX_PATH", tmp_path / "index.json")
    monkeypatch.setattr(prices, "_update_index", lambda entry: None)
    monkeypatch.setattr(prices, "ensure_dirs", lambda: None)

    class FakeClient:
        def fetch_market(self, *, matchday_id=None):
            return COLUMNS, [{"id": 1, "row": row("A, B", "Real Madrid", "G", 10.0, 8.0)}]

    prices.take_snapshot(FakeClient())
    assert calls["clear"] == 1


# ---------------------------------------------------------------------------
# Snapshots repetidos
# ---------------------------------------------------------------------------
def test_mercado_identico_se_detecta(market):
    from efa.ingest.prices import same_market

    later = market.copy()
    later["captured_at"] = "2026-10-01T13:00:00+00:00"
    assert same_market(later, market)
    later.loc[0, "quotation"] = 18.6
    assert not same_market(later, market)
    assert not same_market(market, pd.DataFrame())


def test_no_se_guarda_un_snapshot_sin_cambios(monkeypatch, tmp_path, market):
    from efa import demo
    from efa.ingest import prices

    monkeypatch.setattr(demo, "has_demo_data", lambda: False)
    monkeypatch.setattr(prices, "RAW_PRICES_DIR", tmp_path)
    monkeypatch.setattr(prices, "ensure_dirs", lambda: None)
    monkeypatch.setattr(prices, "latest_snapshot", lambda: market)
    monkeypatch.setattr(prices, "_update_index", lambda entry: pytest.fail("no debía guardarse"))

    class FakeClient:
        def fetch_market(self, *, matchday_id=None):
            return COLUMNS, [
                {"id": 101, "row": row("Vezenkov, Sasha", "Olympiacos", "F", 23.8, 18.5)},
                {"id": 102, "row": row("Larkin, Shane", "Fenerbahce", "G", 17.2, 14.0)},
            ]

    assert prices.take_snapshot(FakeClient()) is None
    assert not list(tmp_path.iterdir())


# ---------------------------------------------------------------------------
# Frescura y precio pendiente (el caso real de la J1)
# ---------------------------------------------------------------------------
def _game(code, round_, when, local, road, played=True):
    return {
        "gameCode": code, "round": round_, "utcDate": when, "played": played,
        "local": {"club": {"code": local}}, "road": {"club": {"code": road}},
    }


GAMES = [
    _game(1, 1, "2026-09-24T18:00:00Z", "OLY", "BAS"),
    _game(2, 1, "2026-09-25T18:45:00Z", "PAR", "MIL"),
    _game(3, 2, "2026-09-29T18:00:00Z", "OLY", "PAR", played=False),
]


def _snap(when, rows):
    return pd.DataFrame(
        [{"fantaking_id": i, "quotation": q, "plus": p, "captured_at": pd.Timestamp(when)} for i, q, p in rows]
    )


def test_captura_a_mitad_de_jornada_es_desfasada():
    from efa.advanced_build import price_freshness

    history = pd.concat([
        _snap("2026-09-24T12:30Z", [(i, 10.0, 0.0) for i in range(30)]),
        _snap("2026-09-25T12:34Z", [(i, 10.0, 0.5) for i in range(30)]),
    ])
    fresh = price_freshness(history, GAMES)
    assert fresh["stale"] and fresh["round"] == 1
    assert "a medias" in fresh["reason"]


def test_jornada_cerrada_pero_sin_aplicar_es_desfasada():
    from efa.advanced_build import price_freshness

    history = pd.concat([
        _snap("2026-09-24T12:30Z", [(i, 10.0, 0.0) for i in range(30)]),
        _snap("2026-09-26T00:30Z", [(i, 10.0, 0.5) for i in range(30)]),
    ])
    fresh = price_freshness(history, GAMES)
    assert fresh["stale"]
    assert "aplicado" in fresh["reason"]


def test_precios_ya_aplicados_no_son_desfasados():
    from efa.advanced_build import price_freshness

    history = pd.concat([
        _snap("2026-09-24T12:30Z", [(i, 10.0, 0.0) for i in range(30)]),
        _snap("2026-09-26T11:54Z", [(i, 10.5, 0.5) for i in range(30)]),
    ])
    assert not price_freshness(history, GAMES)["stale"]


def test_precio_pendiente_con_plus_del_juego_y_con_modelo():
    from efa.advanced_build import pending_prices, price_freshness

    history = pd.concat([
        _snap("2026-09-24T12:30Z", [(1, 17.0, 0.0), (2, 13.6, 0.0), (3, 4.0, 0.0)]),
        _snap("2026-09-25T12:34Z", [(1, 17.0, 0.6), (2, 13.6, 0.0), (3, 4.0, 0.0)]),
    ])
    market = history[history["captured_at"] == history["captured_at"].max()]
    fresh = price_freshness(history, GAMES)
    log = pd.DataFrame(
        [{"person_code": "P2", "game_code": 2, "played": True, "fantasy_points": 36.3}]
    )
    records = [
        {"id": 1, "personCode": "P1", "club": "OLY", "price": 17.0, "isCoach": False},
        {"id": 2, "personCode": "P2", "club": "PAR", "price": 13.6, "isCoach": False},
        {"id": 3, "personCode": "P3", "club": "MIL", "price": 4.0, "isCoach": False},
    ]
    model = {"a": 0.0401, "b": -0.0458, "c": 0.027}
    assert pending_prices(records, market, log, GAMES, model, fresh) == 2
    assert records[0]["pricePending"] == 17.6 and records[0]["pricePendingSource"] == "juego"
    assert records[1]["pricePending"] == 14.5 and records[1]["pricePendingSource"] == "modelo"
    # No jugó y ya está en el mínimo: no baja de 4,0.
    assert "pricePending" not in records[2]
