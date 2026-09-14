"""Ingesta de la API oficial de la EuroLeague.

Guarda crudo en `data/raw/official/<temporada>/`. Los boxscores se cachean por
partido: un partido ya jugado no cambia, así que solo se descarga lo que falta.

Se ingiere también la temporada anterior. No es un capricho: hasta que la
2026-27 tenga jornadas jugadas, el rendimiento real de la 2025-26 es la mejor
referencia disponible, y permite que el dashboard tenga contenido desde el
primer día en vez de estar vacío hasta octubre.
"""
from __future__ import annotations

import gzip
import json
import logging
import time
from pathlib import Path
from typing import Any

from efa.clients import EuroleagueClient
from efa.config import (
    DATA_DIR,
    PRIOR_SEASON_CODE,
    SEASON_CODE,
    boxscores_path,
    ensure_dirs,
    season_dir,
)

log = logging.getLogger(__name__)

FILES = {
    "clubs": "clubs.json",
    "players": "people.json",
    "coaches": "coaches.json",
    "games": "games.json",
}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        shown = path.relative_to(DATA_DIR.parent)
    except ValueError:  # pragma: no cover
        shown = path
    log.info("  escrito %s", shown)


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def ingest_reference(season_code: str = SEASON_CODE, client: EuroleagueClient | None = None) -> dict[str, int]:
    """Clubes, jugadores, entrenadores y calendario completo de una temporada."""
    ensure_dirs()
    client = client or EuroleagueClient(season_code)
    target = season_dir(season_code)

    payloads = {
        "clubs": client.clubs(),
        "players": client.people("J"),
        "coaches": client.people("C"),
        "games": client.games(),
    }
    for key, filename in FILES.items():
        _write_json(target / filename, payloads[key])

    return {key: len(value) for key, value in payloads.items()}


def ingest_boxscores(
    season_code: str = SEASON_CODE,
    client: EuroleagueClient | None = None,
    *,
    force: bool = False,
) -> dict[str, int]:
    """Boxscores de los partidos ya jugados, con caché en disco."""
    ensure_dirs()
    client = client or EuroleagueClient(season_code)
    games = _read_json(season_dir(season_code) / FILES["games"], [])
    if not games:
        raise RuntimeError(
            f"No hay calendario de {season_code} en disco. "
            f"Ejecuta antes `efa ingest-official --season {season_code}`."
        )

    played = [g for g in games if g.get("played")]
    store = {} if force else load_boxscores(season_code)
    pending = [int(g["gameCode"]) for g in played if int(g["gameCode"]) not in store]

    log.info("%s | jugados: %d | por descargar: %d", season_code, len(played), len(pending))

    downloaded = 0
    failed: list[int] = []
    for position, code in enumerate(pending, start=1):
        try:
            store[code] = client.game_stats(code)
        except Exception as exc:  # noqa: BLE001 - se registra y se sigue
            log.warning("Boxscore %s no disponible: %s", code, str(exc)[:160])
            failed.append(code)
            continue
        downloaded += 1
        # Se vuelca cada 25: si la API corta a mitad, lo descargado queda en
        # disco y la siguiente ejecución retoma donde se quedó.
        if position % 25 == 0:
            save_boxscores(season_code, store)
            log.info("  boxscores %d/%d", position, len(pending))
        time.sleep(client.polite_delay)

    if downloaded:
        save_boxscores(season_code, store)

    if failed:
        log.warning(
            "%d boxscores sin descargar. Vuelve a ejecutar el comando para retomarlos.",
            len(failed),
        )

    return {
        "played": len(played),
        "downloaded": downloaded,
        "cached": len(played) - len(pending),
        "failed": len(failed),
    }


def save_boxscores(season_code: str, store: dict[int, dict[str, Any]]) -> Path:
    """Escribe todos los boxscores de una temporada en un único fichero gzip."""
    path = boxscores_path(season_code)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {str(code): value for code, value in sorted(store.items())}
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
    return path


def dedupe_people(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Un registro por persona, quedándose con su club actual.

    El feed oficial mantiene el histórico de la temporada: un jugador traspasado
    en verano aparece dos veces, con el club viejo marcado `active: false`. Si no
    se filtra, el cruce por nombre+equipo puede asignarle el club equivocado y
    todo lo que dependa del club (calendario, dificultad) sale mal.
    """
    best: dict[str, dict[str, Any]] = {}
    for entry in entries:
        code = str((entry.get("person") or {}).get("code") or "")
        if not code:
            continue
        current = best.get(code)
        if current is None or _registration_rank(entry) > _registration_rank(current):
            best[code] = entry
    return list(best.values())


def _registration_rank(entry: dict[str, Any]) -> tuple[int, str]:
    """Activo gana; a igualdad, el registro más reciente."""
    return (1 if entry.get("active") else 0, str(entry.get("startDate") or ""))


def coach_census(season_code: str = SEASON_CODE) -> list[dict[str, Any]]:
    """Censo de entrenadores reconstruido desde los boxscores.

    El endpoint de personas devuelve cero entrenadores (ni con `personType=C`),
    pero cada boxscore sí trae el entrenador de cada banquillo. Como el mercado
    de Fantaking incluye a los 20 entrenadores — puntúan por el marcador de su
    equipo — hace falta poder identificarlos.

    Se toma el club del último partido que dirigieron, que es el dato más
    reciente disponible.
    """
    games = {int(g["gameCode"]): g for g in _read_json(season_dir(season_code) / FILES["games"], []) if g.get("gameCode")}
    latest: dict[str, tuple[str, dict[str, Any]]] = {}

    for game_code, payload in sorted(load_boxscores(season_code).items()):
        game = games.get(game_code)
        for side in ("local", "road"):
            coach = (payload.get(side) or {}).get("coach") or {}
            code = str(coach.get("code") or "")
            if not code:
                continue
            club = ((game or {}).get(side) or {}).get("club") or {}
            date = str((game or {}).get("utcDate") or "")
            if code not in latest or date >= latest[code][0]:
                latest[code] = (
                    date,
                    {
                        "person": {"code": code, "name": coach.get("name", "")},
                        "club": club,
                        "type": "C",
                        "typeName": "Coach",
                        "positionName": "Head Coach",
                        "active": True,
                    },
                )

    return [entry for _, entry in latest.values()]


def load_reference(season_code: str = SEASON_CODE) -> dict[str, Any]:
    """Lee de disco lo ingerido, sin tocar la red."""
    base = season_dir(season_code)
    payload = {key: _read_json(base / filename, []) for key, filename in FILES.items()}
    payload["players"] = dedupe_people(payload["players"])
    payload["coaches"] = dedupe_people(payload["coaches"])
    if not payload["coaches"]:
        payload["coaches"] = coach_census(season_code)
    return payload


def load_boxscores(season_code: str = SEASON_CODE) -> dict[int, dict[str, Any]]:
    """Todos los boxscores cacheados de una temporada, por gameCode."""
    path = boxscores_path(season_code)
    if not path.exists():
        return _migrate_legacy_boxscores(season_code)
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("No se pudo leer %s (%s). Se tratará como vacío.", path.name, exc)
        return {}
    return {int(code): value for code, value in payload.items()}


def _migrate_legacy_boxscores(season_code: str) -> dict[int, dict[str, Any]]:
    """Convierte una caché antigua de un fichero por partido al formato gzip."""
    legacy_dir = season_dir(season_code) / "boxscores"
    if not legacy_dir.is_dir():
        return {}

    store: dict[int, dict[str, Any]] = {}
    for item in sorted(legacy_dir.glob("*.json")):
        try:
            store[int(item.stem)] = json.loads(item.read_text(encoding="utf-8"))
        except (ValueError, json.JSONDecodeError):
            log.warning("Boxscore ilegible, se ignora: %s", item.name)

    if store:
        save_boxscores(season_code, store)
        log.info("Migrados %d boxscores de %s al formato comprimido.", len(store), season_code)
    return store


def ingest_all(
    season_code: str = SEASON_CODE,
    prior_season_code: str | None = PRIOR_SEASON_CODE,
    *,
    with_boxscores: bool = True,
) -> dict[str, Any]:
    """Ingesta completa: temporada actual y, opcionalmente, la anterior."""
    summary: dict[str, Any] = {season_code: ingest_reference(season_code)}
    if with_boxscores:
        summary[season_code]["boxscores"] = ingest_boxscores(season_code)

    if prior_season_code and prior_season_code != season_code:
        summary[prior_season_code] = ingest_reference(prior_season_code)
        if with_boxscores:
            summary[prior_season_code]["boxscores"] = ingest_boxscores(prior_season_code)

    return summary
