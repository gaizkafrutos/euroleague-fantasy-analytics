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
