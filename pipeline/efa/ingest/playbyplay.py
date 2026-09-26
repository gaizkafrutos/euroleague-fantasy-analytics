"""Jugada a jugada y tiros, de la API "live" de la Euroliga.

Dos endpoints públicos que el pipeline no usaba:

  live.euroleague.net/api/PlayByPlay?gamecode=N&seasoncode=E2026
      ~700 eventos por partido: tiros, rebotes, pérdidas, faltas y, sobre
      todo, los CAMBIOS (IN/OUT). Con ellos se sabe quién está en pista en
      cada segundo: quintetos, on/off, minutos por cuarto y en el final.

  live.euroleague.net/api/Points?gamecode=N&seasoncode=E2026
      Cada tiro con coordenadas en centímetros respecto al aro (x lateral,
      y hacia el centro del campo), anotado o fallado, y si fue en
      contraataque, segunda oportunidad o tras pérdida.

El crudo pesa ~250 KB por partido; 400 partidos serían 100 MB en un repo
público. Se guarda condensado, una fila compacta por evento o por tiro, en un
gzip por temporada. Un partido jugado no cambia: se cachea y solo se descarga
lo que falta, igual que los boxscores.
"""
from __future__ import annotations

import gzip
import json
import logging
import time
from pathlib import Path
from typing import Any

import requests

from efa.config import LIVE_API_BASE, SEASON_CODE, ensure_dirs, season_dir

log = logging.getLogger(__name__)

_QUARTERS = ("FirstQuarter", "SecondQuarter", "ThirdQuarter", "ForthQuarter", "ExtraTime")

#: Eventos que hacen falta para quintetos, posesiones y puntuación. El resto
#: (tiempos muertos, saltos, comentarios) no aporta y ocupa.
PBP_TYPES = {
    "BP", "EP", "EG", "IN", "OUT",
    "2FGM", "2FGA", "3FGM", "3FGA", "FTM", "FTA",
    "O", "D", "TO", "ST", "AS", "FV", "AG", "CM", "RV", "OF",
}

#: Columnas de cada evento condensado, en este orden.
PBP_COLUMNS = ["period", "second", "type", "team", "player", "pointsA", "pointsB"]
#: Columnas de cada tiro condensado, en este orden.
SHOT_COLUMNS = ["player", "team", "x", "y", "made", "value", "fastbreak", "secondChance", "offTurnover", "minute"]


def pbp_path(season_code: str = SEASON_CODE) -> Path:
    return season_dir(season_code) / "pbp.json.gz"


def shots_path(season_code: str = SEASON_CODE) -> Path:
    return season_dir(season_code) / "shots.json.gz"


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------
class LiveClient:
    def __init__(self, season_code: str = SEASON_CODE, *, delay: float = 0.35, timeout: int = 30) -> None:
        self.season_code = season_code
        self.delay = delay
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "euroleague-fantasy-analytics/1.0 (personal, non-commercial)",
            }
        )

    def _get(self, endpoint: str, game_code: int) -> Any:
        url = f"{LIVE_API_BASE}/{endpoint}"
        params = {"gamecode": game_code, "seasoncode": self.season_code}
        for attempt in range(1, 5):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                log.warning("Red en %s %s (intento %d): %s", endpoint, game_code, attempt, exc)
                time.sleep(2**attempt)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(int(response.headers.get("Retry-After") or 2**attempt * 5))
                continue
            response.raise_for_status()
            if not response.text.strip():
                raise RuntimeError(f"{endpoint} {game_code}: respuesta vacía")
            return response.json()
        raise RuntimeError(f"No se pudo descargar {endpoint} {game_code}")

    def play_by_play(self, game_code: int) -> dict[str, Any]:
        return self._get("PlayByPlay", game_code)

    def points(self, game_code: int) -> dict[str, Any]:
        return self._get("Points", game_code)


# ---------------------------------------------------------------------------
# Condensado
# ---------------------------------------------------------------------------
def _code(raw: Any) -> str:
    """"P000898   " -> "000898": el mismo código que el censo y el boxscore."""
    text = str(raw or "").strip()
    return text[1:] if text.startswith("P") else text


def _clock_to_elapsed(marker: str, period: int) -> int | None:
    """Segundos transcurridos desde el inicio del partido."""
    marker = (marker or "").strip()
    if not marker or ":" not in marker:
        return None
    minutes, seconds = marker.split(":", 1)
    remaining = int(minutes) * 60 + int(seconds)
    if period <= 4:
        return (period - 1) * 600 + (600 - remaining)
    return 2400 + (period - 5) * 300 + (300 - remaining)


def condense_pbp(raw: dict[str, Any]) -> dict[str, Any]:
    """Del jugada a jugada crudo a una lista de filas compactas.

    Las prórrogas llegan juntas en `ExtraTime`; cada BP abre un periodo nuevo.
    Un evento sin reloj hereda el segundo del anterior.
    """
    rows: list[list[Any]] = []
    period = 0
    last = 0
    for quarter in _QUARTERS:
        for event in raw.get(quarter) or []:
            kind = str(event.get("PLAYTYPE") or "").strip()
            if kind == "BP":
                period += 1
            if kind not in PBP_TYPES:
                continue
            second = _clock_to_elapsed(str(event.get("MARKERTIME") or ""), max(period, 1))
            if second is None:
                second = last
            last = second
            rows.append(
                [
                    period,
                    second,
                    kind,
                    str(event.get("CODETEAM") or "").strip(),
                    _code(event.get("PLAYER_ID")),
                    event.get("POINTS_A"),
                    event.get("POINTS_B"),
                ]
            )
    return {
        "teamA": str(raw.get("CodeTeamA") or "").strip(),
        "teamB": str(raw.get("CodeTeamB") or "").strip(),
        "events": rows,
    }


def condense_points(raw: dict[str, Any]) -> list[list[Any]]:
    """Solo tiros de campo: los libres no tienen coordenadas útiles."""
    rows: list[list[Any]] = []
    for shot in raw.get("Rows") or []:
        action = str(shot.get("ID_ACTION") or "").strip()
        if action not in {"2FGM", "2FGA", "3FGM", "3FGA"}:
            continue
        rows.append(
            [
                _code(shot.get("ID_PLAYER")),
                str(shot.get("TEAM") or "").strip(),
                int(shot.get("COORD_X") or 0),
                int(shot.get("COORD_Y") or 0),
                1 if action.endswith("M") else 0,
                3 if action.startswith("3") else 2,
                1 if str(shot.get("FASTBREAK")) == "1" else 0,
                1 if str(shot.get("SECOND_CHANCE")) == "1" else 0,
                1 if str(shot.get("POINTS_OFF_TURNOVER")) == "1" else 0,
                int(shot.get("MINUTE") or 0),
            ]
        )
    return rows


# ---------------------------------------------------------------------------
# Almacén
# ---------------------------------------------------------------------------
def _load(path: Path) -> dict[int, Any]:
    if not path.exists():
        return {}
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return {int(code): value for code, value in json.load(handle).items()}
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("No se pudo leer %s (%s). Se tratará como vacío.", path.name, exc)
        return {}


def _save(path: Path, store: dict[int, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {str(code): value for code, value in sorted(store.items())}
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def load_pbp(season_code: str = SEASON_CODE) -> dict[int, dict[str, Any]]:
    return _load(pbp_path(season_code))


def load_shots(season_code: str = SEASON_CODE) -> dict[int, list[list[Any]]]:
    return _load(shots_path(season_code))


def shots_frame(season_code: str = SEASON_CODE):
    """Todos los tiros de una temporada como DataFrame, con el gameCode."""
    import pandas as pd

    rows = [[code, *row] for code, shots in load_shots(season_code).items() for row in shots]
    return pd.DataFrame(rows, columns=["game_code", *SHOT_COLUMNS])


def ingest_playbyplay(season_code: str = SEASON_CODE, game_codes: list[int] | None = None) -> dict[str, int]:
    """Descarga jugada a jugada y tiros de los partidos jugados que falten."""
    ensure_dirs()
    if game_codes is None:
        games_path = season_dir(season_code) / "games.json"
        games = json.loads(games_path.read_text(encoding="utf-8")) if games_path.exists() else []
        game_codes = [int(g["gameCode"]) for g in games if g.get("played")]

    pbp = load_pbp(season_code)
    shots = load_shots(season_code)
    pending = [code for code in sorted(game_codes) if code not in pbp or code not in shots]
    log.info("%s | jugada a jugada: %d en caché, %d por descargar", season_code, len(pbp), len(pending))

    client = LiveClient(season_code)
    done = failed = 0
    for position, code in enumerate(pending, start=1):
        try:
            if code not in pbp:
                pbp[code] = condense_pbp(client.play_by_play(code))
                time.sleep(client.delay)
            if code not in shots:
                shots[code] = condense_points(client.points(code))
                time.sleep(client.delay)
            done += 1
        except Exception as exc:  # noqa: BLE001 - se registra y se sigue
            log.warning("Jugada a jugada %s no disponible: %s", code, str(exc)[:160])
            failed += 1
        if position % 25 == 0:
            _save(pbp_path(season_code), pbp)
            _save(shots_path(season_code), shots)
            log.info("  jugada a jugada %d/%d", position, len(pending))

    if done:
        _save(pbp_path(season_code), pbp)
        _save(shots_path(season_code), shots)
    return {"downloaded": done, "failed": failed, "cached": len(game_codes) - len(pending)}
