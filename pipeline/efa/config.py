"""Configuración central del proyecto.

Todo lo que sea una ruta, una constante de la competición o una regla del juego
vive aquí, para que el resto del código no tenga literales dispersos.
"""
from __future__ import annotations

import os
from pathlib import Path

# --------------------------------------------------------------------------
# Rutas
# --------------------------------------------------------------------------
# efa/config.py -> efa/ -> pipeline/ -> raíz del repo
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"

RAW_PRICES_DIR = DATA_DIR / "raw" / "prices"
RAW_OFFICIAL_DIR = DATA_DIR / "raw" / "official"
RAW_ROSTER_DIR = DATA_DIR / "raw" / "roster"
PROCESSED_DIR = DATA_DIR / "processed"
OVERRIDES_DIR = DATA_DIR / "overrides"

# Salida que consume la app Next.js (se importa en build time).
WEB_DATA_DIR = REPO_ROOT / "web" / "src" / "data"

PLAYER_OVERRIDES_PATH = OVERRIDES_DIR / "player_overrides.csv"
CLUB_COLORS_PATH = OVERRIDES_DIR / "club_colors.csv"
UNMATCHED_REPORT_PATH = PROCESSED_DIR / "unmatched_players.csv"
CROSSWALK_PATH = PROCESSED_DIR / "crosswalk.csv"

# --------------------------------------------------------------------------
# Competición
# --------------------------------------------------------------------------
SEASON_CODE = os.environ.get("EFA_SEASON_CODE", "E2026")
#: Temporada anterior. Sirve de línea base mientras la actual no tiene partidos:
#: en septiembre el dashboard ya enseña rendimiento real en vez de estar vacío.
PRIOR_SEASON_CODE = os.environ.get("EFA_PRIOR_SEASON_CODE", "E2025")
COMPETITION_CODE = "E"


def season_dir(season_code: str = SEASON_CODE) -> Path:
    """Directorio de datos crudos oficiales de una temporada."""
    return RAW_OFFICIAL_DIR / season_code


def boxscores_path(season_code: str = SEASON_CODE) -> Path:
    """Todos los boxscores de una temporada en un único fichero comprimido.

    402 JSON sueltos en un repositorio público son ruido: ensucian los diffs,
    hacen lento el clonado y no aportan nada frente a un solo fichero gzip que
    ocupa una décima parte.
    """
    return season_dir(season_code) / "boxscores.json.gz"

# Fantaking / EuroLeague Fantasy Challenge
FANTAKING_API_BASE = "https://fantaking-api.dunkest.com/api/v1"
FANTAKING_COMPETITION_ID = 49  # EuroLeague
FANTAKING_PER_PAGE = 100  # per_page > 100 devuelve 422
FANTAKING_ORIGIN = "https://euroleaguefantasy.euroleaguebasketball.net"

# API oficial de la EuroLeague (sin autenticación)
EUROLEAGUE_API_BASE = "https://api-live.euroleague.net/v2"

# --------------------------------------------------------------------------
# Reglas del juego (fantaking.gitbook.io/euroleague-fantasy-challenge-rules)
# --------------------------------------------------------------------------
ROSTER_BUDGET = 100.0          # créditos iniciales
ROSTER_GUARDS = 4
ROSTER_FORWARDS = 4
ROSTER_CENTERS = 2
ROSTER_COACHES = 1
ROSTER_SIZE = ROSTER_GUARDS + ROSTER_FORWARDS + ROSTER_CENTERS + ROSTER_COACHES  # 11
MAX_PLAYERS_PER_CLUB = 6
CAPTAIN_MULTIPLIER = 2.0
BENCH_MULTIPLIER = 0.5
WIN_BONUS_RATE = 0.10          # +10% del score de la jornada si tu equipo gana
MAX_TRADES_PER_ROUND = 4

# Puntuación del entrenador, por margen de resultado.
COACH_SCORING = {
    "win_1_10": 10,
    "win_11_20": 20,
    "win_20_plus": 25,
    "win_ot": 10,
    "loss_1_10": -5,
    "loss_11_20": -10,
    "loss_20_plus": -20,
    "loss_ot": -5,
}

# --------------------------------------------------------------------------
# Parámetros de análisis
# --------------------------------------------------------------------------
FORM_WINDOW = 5           # jornadas para la media de forma reciente
MIN_GAMES_FOR_TREND = 3   # partidos mínimos antes de fiarse de una tendencia
ROLE_ALERT_MIN_DELTA = 4.0  # minutos de variación para lanzar alerta de rol


def ensure_dirs() -> None:
    """Crea todos los directorios de datos si no existen."""
    for path in (
        RAW_PRICES_DIR,
        RAW_OFFICIAL_DIR,
        season_dir(SEASON_CODE),
        RAW_ROSTER_DIR,
        PROCESSED_DIR,
        OVERRIDES_DIR,
        WEB_DATA_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
