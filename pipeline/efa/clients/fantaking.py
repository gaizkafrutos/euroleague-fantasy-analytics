"""Cliente del backend de Fantaking (EuroLeague Fantasy Challenge).

El frontend oficial (euroleaguefantasy.euroleaguebasketball.net) es una app
Flutter que habla contra `fantaking-api.dunkest.com`. La Euroliga es la
`competition_id=49`.

Autenticación: header `Authorization: Bearer <token>`, formato Laravel Sanctum
(`id|cadena`). El token es personal — se pasa SIEMPRE por variable de entorno
(`FANTAKING_TOKEN`), nunca hardcodeado ni committeado.
"""
from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import requests

from efa.config import (
    FANTAKING_API_BASE,
    FANTAKING_COMPETITION_ID,
    FANTAKING_ORIGIN,
    FANTAKING_PER_PAGE,
)

log = logging.getLogger(__name__)


class FantakingAuthError(RuntimeError):
    """El token falta, ha caducado o ha sido revocado."""


class FantakingError(RuntimeError):
    """Cualquier otro fallo de la API."""


@dataclass(frozen=True)
class MarketPage:
    columns: list[str]
    players: list[dict[str, Any]]
    current_page: int
    last_page: int
    total: int


class FantakingClient:
    """Wrapper fino sobre la API, con reintentos y mensajes de error claros.

    Un snapshot completo del mercado son 4 peticiones (347 jugadores / 100 por
    página). No hay ninguna razón para ir rápido: se espera medio segundo entre
    páginas por cortesía con la API.
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        competition_id: int = FANTAKING_COMPETITION_ID,
        timeout: int = 20,
        polite_delay: float = 0.5,
        max_retries: int = 3,
    ) -> None:
        self.token = token or os.environ.get("FANTAKING_TOKEN") or ""
        if not self.token:
            raise FantakingAuthError(
                "Falta la variable de entorno FANTAKING_TOKEN.\n"
                "  PowerShell:  $env:FANTAKING_TOKEN = '1234567|abcDEF...'\n"
                "  bash/zsh:    export FANTAKING_TOKEN='1234567|abcDEF...'\n"
                "Cómo obtenerlo: ver docs/TOKEN.md"
            )
        self.competition_id = competition_id
        self.timeout = timeout
        self.polite_delay = polite_delay
        self.max_retries = max_retries

        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {self.token}",
                "Origin": FANTAKING_ORIGIN,
                "Referer": f"{FANTAKING_ORIGIN}/",
                "Accept": "application/json",
                "User-Agent": "euroleague-fantasy-analytics/1.0 (personal, non-commercial)",
            }
        )

    # ------------------------------------------------------------------
    # Transporte
    # ------------------------------------------------------------------
    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f"{FANTAKING_API_BASE}{path}"
        last_exc: Exception | None = None

        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:  # red caída, DNS, timeout
                last_exc = exc
                log.warning("Fallo de red en %s (intento %d/%d): %s", path, attempt, self.max_retries, exc)
                time.sleep(2 ** attempt)
                continue

            if resp.status_code == 401:
                raise FantakingAuthError(
                    "401 de fantaking-api: el token ha caducado o es inválido.\n"
                    "Renuévalo siguiendo docs/TOKEN.md y actualiza el secret "
                    "FANTAKING_TOKEN en GitHub (Settings > Secrets and variables > Actions)."
                )
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 30))
                log.warning("429 rate limit, esperando %ss", wait)
                time.sleep(wait)
                continue
            if resp.status_code >= 500:
                last_exc = FantakingError(f"{resp.status_code} en {path}")
                log.warning("Error de servidor %s (intento %d/%d)", resp.status_code, attempt, self.max_retries)
                time.sleep(2 ** attempt)
                continue
            if not resp.ok:
                raise FantakingError(f"{resp.status_code} en {path}: {resp.text[:300]}")

            return resp.json()

        raise FantakingError(f"No se pudo completar {path} tras {self.max_retries} intentos") from last_exc

    # ------------------------------------------------------------------
    # Mercado
    # ------------------------------------------------------------------
    def market_page(self, page: int = 1, *, matchday_id: int | None = None) -> MarketPage:
        """Una página de la tabla de jugadores con precio y estadísticas."""
        params: dict[str, Any] = {
            "stats_type": "avg",
            "page": page,
            "per_page": FANTAKING_PER_PAGE,
            "sort_by": "fpt",
            "sort_order": "desc",
            "active_players": "true",
            "quotations": "0,30",
        }
        if matchday_id is not None:
            params["matchdays"] = matchday_id

        payload = self._get(
            f"/competitions/{self.competition_id}/stats/players/table", params
        )
        data = payload["data"]
        meta = payload.get("meta", {})
        return MarketPage(
            columns=list(data["columns"]),
            players=list(data["players"]),
            current_page=int(meta.get("current_page", page)),
            last_page=int(meta.get("last_page", page)),
            total=int(meta.get("total", len(data["players"]))),
        )

    def iter_market(self, *, matchday_id: int | None = None) -> Iterator[MarketPage]:
        """Recorre todas las páginas del mercado."""
        first = self.market_page(1, matchday_id=matchday_id)
        yield first
        for page in range(2, first.last_page + 1):
            time.sleep(self.polite_delay)
            yield self.market_page(page, matchday_id=matchday_id)

    def fetch_market(self, *, matchday_id: int | None = None) -> tuple[list[str], list[dict[str, Any]]]:
        """Snapshot completo: (columnas, jugadores)."""
        columns: list[str] = []
        players: list[dict[str, Any]] = []
        for page in self.iter_market(matchday_id=matchday_id):
            if not columns:
                columns = page.columns
                log.info("Mercado: %d jugadores en %d páginas", page.total, page.last_page)
            elif page.columns != columns:
                raise FantakingError(
                    "Las columnas cambian entre páginas — la API ha cambiado de forma."
                )
            players.extend(page.players)
            log.info("  página %d/%d (%d jugadores)", page.current_page, page.last_page, len(page.players))
        return columns, players

    # ------------------------------------------------------------------
    # Equipo personal
    # ------------------------------------------------------------------
    def roster(self, team_id: int, matchday_id: int) -> dict[str, Any]:
        """Roster de una de tus plantillas fantasy en una jornada concreta."""
        return self._get(f"/fantasy-teams/{team_id}/matchdays/{matchday_id}/roster")

    # ------------------------------------------------------------------
    # Descubrimiento de endpoints
    # ------------------------------------------------------------------
    #: Rutas candidatas para resolver la jornada vigente. El tráfico de red de
    #: la app mostraba llamadas a `tournaments` y `fantasy-teams` que no se
    #: llegaron a inspeccionar; `efa discover` las prueba todas con tu token y
    #: reporta cuáles responden, para fijar la buena sin adivinar.
    DISCOVERY_PATHS: tuple[str, ...] = (
        "/competitions",
        "/competitions/{cid}",
        "/competitions/{cid}/matchdays",
        "/competitions/{cid}/rounds",
        "/competitions/{cid}/tournaments",
        "/competitions/{cid}/current-matchday",
        "/competitions/{cid}/settings",
        "/tournaments",
        "/matchdays",
        "/fantasy-teams",
        "/user",
        "/me",
    )

    def discover(self) -> list[dict[str, Any]]:
        """Prueba las rutas candidatas y devuelve un informe de cuáles existen.

        No lanza excepción por rutas que fallan: el objetivo es justamente
        mapear qué hay disponible.
        """
        report: list[dict[str, Any]] = []
        for template in self.DISCOVERY_PATHS:
            path = template.format(cid=self.competition_id)
            url = f"{FANTAKING_API_BASE}{path}"
            try:
                resp = self.session.get(url, timeout=self.timeout)
            except requests.RequestException as exc:
                report.append({"path": path, "status": "network-error", "detail": str(exc)[:120]})
                continue

            entry: dict[str, Any] = {"path": path, "status": resp.status_code}
            if resp.ok:
                try:
                    body = resp.json()
                    entry["keys"] = list(body)[:12] if isinstance(body, dict) else f"list[{len(body)}]"
                    entry["preview"] = str(body)[:400]
                except ValueError:
                    entry["preview"] = resp.text[:200]
            report.append(entry)
            time.sleep(self.polite_delay)
        return report
