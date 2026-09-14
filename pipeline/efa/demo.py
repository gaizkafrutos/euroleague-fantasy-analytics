"""Precios de demostración.

Sin token no hay precios, y sin precios media interfaz no tiene nada que
enseñar. Este módulo fabrica un mercado coherente a partir del rendimiento real
de la temporada anterior, para que:

  - el repo funcione al clonarlo, sin credenciales de nadie;
  - se pueda desarrollar y revisar la web sin gastar llamadas a la API real.

Los snapshots que genera llevan `DEMO` en el nombre y activan un aviso visible
en la web. No se parecen a los precios reales y no pretenden hacerlo: son una
maqueta con la forma correcta.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from efa.config import RAW_PRICES_DIR, SEASON_CODE, ensure_dirs
from efa.gamelogs import build_gamelog
from efa.ingest.official import load_boxscores, load_reference
from efa.ingest.prices import _update_index
from efa.metrics import player_performance
from efa.optimizer import normalize_position

log = logging.getLogger(__name__)

DEMO_PREFIX = "prices_DEMO"
MIN_PRICE = 3.0
MAX_PRICE = 22.0


def generate(
    performance_season: str,
    *,
    target_season: str | None = None,
    snapshots: int = 4,
    seed: int = 7,
) -> list[str]:
    """Crea un histórico de precios ficticio con la forma del real.

    El censo es el de la temporada objetivo (los jugadores que realmente están
    en la liga ahora) y el rendimiento viene de `performance_season`. Así la
    demo cruza al 100% con el censo oficial, igual que lo hará el mercado real,
    en vez de arrastrar jugadores que ya se fueron.
    """
    ensure_dirs()
    rng = np.random.default_rng(seed)

    target_season = target_season or SEASON_CODE
    boxscores = load_boxscores(performance_season)
    if not boxscores:
        raise RuntimeError(
            f"No hay boxscores de {performance_season}. Ejecuta antes "
            f"`efa ingest-official --season {performance_season}`."
        )

    source_reference = load_reference(performance_season)
    gamelog = build_gamelog(boxscores, source_reference.get("games", []))
    performance = player_performance(gamelog).set_index("person_code")

    target_reference = load_reference(target_season)
    rows = []
    for entry in target_reference.get("players", []):
        person = entry.get("person") or {}
        club = entry.get("club") or {}
        code = str(person.get("code") or "")
        position = normalize_position(entry.get("positionName"))
        if not code or not position:
            continue

        if code in performance.index:
            record = performance.loc[code]
            fpt = float(record["fp_avg"])
            minutes = float(record["minutes_avg"])
            games = int(record["games_played"])
        else:
            # Debutante sin historial: se le asigna un perfil discreto, que es
            # justo lo que hace el mercado real con un desconocido.
            fpt = float(rng.uniform(4, 10))
            minutes = float(rng.uniform(8, 18))
            games = 0

        rows.append(
            {
                "person_code": code,
                "name": person.get("name", ""),
                "team": club.get("name", ""),
                "position": position,
                "fpt": round(fpt, 2),
                "minutes": round(minutes, 1),
                "games": games,
                "pts": 0.0,
            }
        )

    if not rows:
        raise RuntimeError("No se pudo derivar ningún jugador para la demo.")

    frame = pd.DataFrame(rows)

    # Precio creciente con el rendimiento, comprimido en los extremos: así se
    # reproduce la curva del mercado real, donde los mejores no cuestan
    # proporcionalmente lo que rinden.
    performance_index = frame["fpt"].clip(lower=0)
    normalized = (performance_index / performance_index.max()).fillna(0)
    base_price = MIN_PRICE + (MAX_PRICE - MIN_PRICE) * normalized**0.78
    base_price *= 1 + rng.normal(0, 0.07, len(frame))  # ruido de mercado
    frame["quotation"] = base_price.clip(MIN_PRICE, MAX_PRICE).round(1)

    written: list[str] = []
    now = datetime.now(timezone.utc)
    current = frame["quotation"].to_numpy(dtype=float)

    for index in range(snapshots):
        captured = now - timedelta(days=7 * (snapshots - index - 1))
        if index > 0:
            # Variación por jornada: sube quien rinde por encima de su banda.
            drift = rng.normal(0, 0.22, len(frame)) + (normalized.to_numpy() - 0.5) * 0.18
            current = np.clip(current + drift.round(1), MIN_PRICE, MAX_PRICE)

        snapshot = frame.copy()
        snapshot["quotation"] = np.round(current, 1)
        snapshot["plus"] = 0.0
        snapshot["fantaking_id"] = [
            int(code) if str(code).isdigit() else abs(hash(code)) % 10**6
            for code in snapshot["person_code"]
        ]
        snapshot["captured_at"] = captured.isoformat()
        for column in ("reb", "ast", "stl", "tov", "blk", "blka", "fd", "pf", "fg_missed", "ft_missed"):
            snapshot[column] = np.nan
        snapshot = snapshot.drop(columns=["person_code", "minutes", "games"])

        slug = f"{DEMO_PREFIX}_{captured.strftime('%Y%m%d_%H%M%S')}"
        parquet_path = RAW_PRICES_DIR / f"{slug}.parquet"
        snapshot.to_parquet(parquet_path, index=False)
        snapshot.to_csv(RAW_PRICES_DIR / f"{slug}.csv", index=False, encoding="utf-8")
        _update_index(
            {
                "file": parquet_path.name,
                "csv": f"{slug}.csv",
                "captured_at": captured.isoformat(),
                "label": "DEMO",
                "matchday_id": None,
                "players": int(len(snapshot)),
                "columns": list(snapshot.columns),
                "demo": True,
            }
        )
        written.append(parquet_path.name)

    log.info("Generados %d snapshots de demostración (%d jugadores).", len(written), len(frame))
    return written


def clear() -> int:
    """Borra los snapshots de demostración. No toca los reales."""
    removed = 0
    for path in list(RAW_PRICES_DIR.glob(f"{DEMO_PREFIX}*")):
        path.unlink()
        removed += 1
    index_path = RAW_PRICES_DIR / "index.json"
    if index_path.exists():
        import json

        index = json.loads(index_path.read_text(encoding="utf-8"))
        index = [entry for entry in index if not entry.get("demo")]
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    return removed


def has_demo_data() -> bool:
    return any(RAW_PRICES_DIR.glob(f"{DEMO_PREFIX}*.parquet"))
