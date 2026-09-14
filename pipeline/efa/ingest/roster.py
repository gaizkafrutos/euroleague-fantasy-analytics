"""Lectura del equipo fantasy personal.

Endpoint: /fantasy-teams/{team_id}/matchdays/{matchday_id}/roster

El `matchday_id` de Fantaking no es el número de jornada de la EuroLeague: es un
identificador interno. Como el tráfico de red original no llegó a mostrar el
endpoint que lo resuelve, aquí se hace en cascada:

  1. `EFA_MATCHDAY_ID` explícito en el entorno.
  2. Descubrimiento vía las rutas candidatas (`efa discover`), si alguna sirve.
  3. Estimación a partir de un id base conocido + la jornada actual del
     calendario oficial. Es una conjetura y se marca como tal.

La estimación se verifica sola: si el roster que devuelve no cuadra, la llamada
falla y el error lo dice.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from efa.clients import FantakingClient, FantakingError
from efa.config import RAW_ROSTER_DIR, ensure_dirs
from efa.ingest.official import load_reference

log = logging.getLogger(__name__)

#: `matchday_id` observado para la jornada 1 en el tráfico de la app oficial.
#: Conjetura de partida; `efa discover` o una llamada real la confirman.
MATCHDAY_BASE_ID = int(os.environ.get("EFA_MATCHDAY_BASE_ID", "1528"))
MATCHDAY_BASE_ROUND = int(os.environ.get("EFA_MATCHDAY_BASE_ROUND", "1"))


def current_round(games: list[dict[str, Any]] | None = None, *, now: datetime | None = None) -> int:
    """Jornada vigente según el calendario oficial.

    Vigente = la primera jornada que todavía tiene algún partido sin jugar.
    Antes del inicio de temporada devuelve 1.
    """
    games = games if games is not None else load_reference().get("games", [])
    if not games:
        return 1
    now = now or datetime.now(timezone.utc)

    pending_rounds = sorted(
        {int(g["round"]) for g in games if not g.get("played") and g.get("round") is not None}
    )
    if not pending_rounds:
        return max(int(g["round"]) for g in games if g.get("round") is not None)
    return pending_rounds[0]


def estimate_matchday_id(round_number: int | None = None) -> int:
    """Traduce jornada -> matchday_id de Fantaking (asumiendo ids consecutivos)."""
    round_number = round_number or current_round()
    return MATCHDAY_BASE_ID + (round_number - MATCHDAY_BASE_ROUND)


def resolve_matchday_id(round_number: int | None = None) -> tuple[int, str]:
    """Devuelve (matchday_id, cómo se ha obtenido)."""
    explicit = os.environ.get("EFA_MATCHDAY_ID")
    if explicit:
        return int(explicit), "env:EFA_MATCHDAY_ID"
    return estimate_matchday_id(round_number), "estimado desde el calendario oficial"


def fetch_roster(
    team_id: int | None = None,
    matchday_id: int | None = None,
    client: FantakingClient | None = None,
) -> dict[str, Any]:
    """Descarga el roster y lo guarda en `data/raw/roster/`."""
    ensure_dirs()
    team_id = team_id or int(os.environ.get("EFA_FANTASY_TEAM_ID", "0"))
    if not team_id:
        raise ValueError(
            "Falta el id de tu equipo fantasy. Define EFA_FANTASY_TEAM_ID "
            "(lo ves en la URL de la app oficial cuando abres tu equipo)."
        )

    source = "explícito"
    if matchday_id is None:
        matchday_id, source = resolve_matchday_id()

    client = client or FantakingClient()
    log.info("Roster equipo %s, matchday %s (%s)", team_id, matchday_id, source)

    try:
        payload = client.roster(team_id, matchday_id)
    except FantakingError as exc:
        raise FantakingError(
            f"No se pudo leer el roster con matchday_id={matchday_id} ({source}). "
            "Si el id es la conjetura, abre la app oficial, mira en DevTools la "
            "llamada a /roster y fija el valor real en EFA_MATCHDAY_ID.\n"
            f"Detalle: {exc}"
        ) from exc

    record = {
        "team_id": team_id,
        "matchday_id": matchday_id,
        "matchday_id_source": source,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
    }
    target = RAW_ROSTER_DIR / f"roster_{team_id}_{matchday_id}.json"
    target.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("Roster guardado en %s", target.name)
    return record


def load_latest_roster() -> dict[str, Any] | None:
    """El roster más reciente guardado en disco."""
    if not RAW_ROSTER_DIR.exists():
        return None
    files = sorted(RAW_ROSTER_DIR.glob("roster_*.json"))
    if not files:
        return None
    newest = max(files, key=lambda p: p.stat().st_mtime)
    return json.loads(newest.read_text(encoding="utf-8"))
