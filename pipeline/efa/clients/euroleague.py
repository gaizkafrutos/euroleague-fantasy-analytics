"""Cliente de la API oficial de la EuroLeague (api-live.euroleague.net/v2).

Pública, sin autenticación. Da clubes, plantillas, calendario completo y
boxscores por partido. Es la fuente de verdad para las estadísticas reales:
los precios salen de Fantaking, el juego sale de aquí.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

from efa.config import COMPETITION_CODE, EUROLEAGUE_API_BASE, SEASON_CODE

log = logging.getLogger(__name__)


class EuroleagueError(RuntimeError):
    pass


class EuroleagueClient:
    def __init__(
        self,
        season_code: str = SEASON_CODE,
        *,
        competition_code: str = COMPETITION_CODE,
        timeout: int = 30,
        polite_delay: float = 0.6,
        max_retries: int = 5,
    ) -> None:
        self.season_code = season_code
        self.competition_code = competition_code
        self.timeout = timeout
        self.polite_delay = polite_delay
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": "euroleague-fantasy-analytics/1.0 (personal, non-commercial)",
            }
        )

    @property
    def _season_base(self) -> str:
        return (
            f"{EUROLEAGUE_API_BASE}/competitions/{self.competition_code}"
            f"/seasons/{self.season_code}"
        )

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self._season_base}{path}"
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                log.warning("Red: %s (intento %d)", exc, attempt)
                time.sleep(2 ** attempt)
                continue
            if resp.status_code == 429:
                # Cloudflare corta a partir de ~60 peticiones seguidas. No hay
                # prisa ninguna: se espera y se baja el ritmo para el resto.
                wait = int(resp.headers.get("Retry-After") or 30)
                log.warning("429 rate limit en %s: esperando %ss", path, wait)
                time.sleep(wait)
                self.polite_delay = min(self.polite_delay * 1.5, 5.0)
                continue
            if resp.status_code >= 500:
                log.warning("Servidor %s en %s (intento %d)", resp.status_code, path, attempt)
                time.sleep(2 ** attempt)
                continue
            if not resp.ok:
                raise EuroleagueError(f"{resp.status_code} en {path}: {resp.text[:200]}")
            return resp.json()
        raise EuroleagueError(f"No se pudo completar {path}")

    # ------------------------------------------------------------------
    def clubs(self) -> list[dict[str, Any]]:
        """Los clubes de la temporada (20 en la 2026-27)."""
        return self._get("/clubs").get("data", [])

    def people(self, person_type: str = "J", limit: int = 1000) -> list[dict[str, Any]]:
        """Personas de la temporada. `J` = jugadores, `C` = entrenadores."""
        return self._get("/people", {"personType": person_type, "limit": limit}).get("data", [])

    def games(self, limit: int = 1000) -> list[dict[str, Any]]:
        """Calendario completo, jugado y por jugar."""
        return self._get("/games", {"limit": limit}).get("data", [])

    def game_stats(self, game_code: int) -> dict[str, Any]:
        """Boxscore de un partido: `local`/`road`, cada uno con `players` y `total`."""
        return self._get(f"/games/{game_code}/stats")

    def fetch_boxscores(self, game_codes: list[int]) -> dict[int, dict[str, Any]]:
        """Boxscores de varios partidos, con pausa entre llamadas."""
        out: dict[int, dict[str, Any]] = {}
        for i, code in enumerate(game_codes, start=1):
            try:
                out[code] = self.game_stats(code)
            except EuroleagueError as exc:
                log.warning("Boxscore %s no disponible: %s", code, exc)
                continue
            if i % 20 == 0:
                log.info("  boxscores %d/%d", i, len(game_codes))
            time.sleep(self.polite_delay)
        return out
