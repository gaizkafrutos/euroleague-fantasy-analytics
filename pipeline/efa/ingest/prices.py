"""Captura de snapshots del mercado (precios en créditos).

Cada ejecución guarda un fichero con marca de tiempo en
`data/raw/prices/`. Acumulados jornada a jornada forman la serie temporal de
precios, que es lo que permite ver quién sube y quién baja.

Formato: Parquet (compacto, tipado) + un CSV espejo por snapshot para que el
histórico sea legible en el propio GitHub sin herramientas.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from efa.clients import FantakingClient
from efa.config import RAW_PRICES_DIR, ensure_dirs

log = logging.getLogger(__name__)

INDEX_PATH = RAW_PRICES_DIR / "index.json"


def market_to_frame(columns: list[str], players: list[dict[str, Any]], captured_at: str) -> pd.DataFrame:
    """Convierte la respuesta {id, row: [...]} en un DataFrame tipado."""
    records = []
    for player in players:
        row = dict(zip(columns, player["row"], strict=False))
        row["fantaking_id"] = player["id"]
        records.append(row)

    frame = pd.DataFrame.from_records(records)
    frame["captured_at"] = captured_at

    numeric = [
        c
        for c in frame.columns
        if c not in {"name", "position", "team", "captured_at", "fantaking_id"}
    ]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    ordered = ["fantaking_id", "name", "team", "position"] + [
        c for c in frame.columns if c not in {"fantaking_id", "name", "team", "position", "captured_at"}
    ] + ["captured_at"]
    return frame[[c for c in ordered if c in frame.columns]]


def take_snapshot(
    client: FantakingClient | None = None,
    *,
    matchday_id: int | None = None,
    label: str | None = None,
) -> Path:
    """Captura el mercado completo y lo persiste.

    `label` permite etiquetar el snapshot con la jornada (ej. "R03"), lo que
    hace el histórico mucho más legible que una marca de tiempo suelta.
    """
    ensure_dirs()
    client = client or FantakingClient()

    now = datetime.now(timezone.utc)
    captured_at = now.isoformat()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    slug = f"{stamp}" + (f"_{label}" if label else "")

    columns, players = client.fetch_market(matchday_id=matchday_id)
    frame = market_to_frame(columns, players, captured_at)

    # Importación local para no crear un ciclo: `demo` ya depende de este módulo.
    from efa import demo

    if demo.has_demo_data():
        removed = demo.clear()
        log.warning(
            "Eliminados %d ficheros de demostración: el histórico real no se mezcla "
            "con precios inventados.",
            removed,
        )

    parquet_path = RAW_PRICES_DIR / f"prices_{slug}.parquet"
    csv_path = RAW_PRICES_DIR / f"prices_{slug}.csv"
    frame.to_parquet(parquet_path, index=False)
    frame.to_csv(csv_path, index=False, encoding="utf-8")

    _update_index(
        {
            "file": parquet_path.name,
            "csv": csv_path.name,
            "captured_at": captured_at,
            "label": label,
            "matchday_id": matchday_id,
            "players": int(len(frame)),
            "columns": list(frame.columns),
        }
    )

    log.info("Snapshot guardado: %s (%d jugadores)", parquet_path.name, len(frame))
    return parquet_path


def _update_index(entry: dict[str, Any]) -> None:
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8")) if INDEX_PATH.exists() else []
    index.append(entry)
    index.sort(key=lambda item: item["captured_at"])
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")


def load_snapshots() -> pd.DataFrame:
    """Concatena todo el histórico de snapshots en un único DataFrame largo."""
    files = sorted(RAW_PRICES_DIR.glob("prices_*.parquet"))
    if not files:
        return pd.DataFrame()
    frames = [pd.read_parquet(path) for path in files]
    combined = pd.concat(frames, ignore_index=True)
    combined["captured_at"] = pd.to_datetime(combined["captured_at"], utc=True, format="mixed")
    return combined.sort_values(["fantaking_id", "captured_at"]).reset_index(drop=True)


def latest_snapshot() -> pd.DataFrame:
    """El snapshot más reciente."""
    history = load_snapshots()
    if history.empty:
        return history
    newest = history["captured_at"].max()
    return history[history["captured_at"] == newest].reset_index(drop=True)
