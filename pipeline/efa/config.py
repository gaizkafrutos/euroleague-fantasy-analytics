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
RAW_INJURIES_DIR = DATA_DIR / "raw" / "injuries"
PROCESSED_DIR = DATA_DIR / "processed"
OVERRIDES_DIR = DATA_DIR / "overrides"

# Salida que consume la app Next.js (se importa en build time).
WEB_DATA_DIR = REPO_ROOT / "web" / "src" / "data"

PLAYER_OVERRIDES_PATH = OVERRIDES_DIR / "player_overrides.csv"
CLUB_COLORS_PATH = OVERRIDES_DIR / "club_colors.csv"
INJURY_OVERRIDES_PATH = OVERRIDES_DIR / "injury_overrides.csv"
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
#: API "live" (la del marcador en directo): jugada a jugada y tiros con coordenadas.
LIVE_API_BASE = "https://live.euroleague.net/api"

# Parte de lesiones (BasketNews, actualizado a diario). Ninguna API del
# proyecto trae lesiones ni convocatorias.
INJURY_REPORT_URL = "https://basketnews.com/news-212393-euroleague-injury-report-updated.html"
#: Fuentes de respaldo: BasketNews rechaza a veces a los runners de GitHub.
INJURY_SPHERE_URL = "https://basketballsphere.com/en/injuries/euroleague/"
INJURY_ROTOWIRE_URL = "https://www.rotowire.com/euro/tables/injury-report.php?team=ALL&pos=ALL"

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
#: Peso máximo de la forma (últimos 5) frente a la media en la proyección. Era
#: 0,6; en el backtest de la 2025-26 (7.764 predicciones a un paso) la forma no
#: mejora a la media simple y el 0,6 subía el error medio de 6,05 a 6,11.
FORM_WEIGHT_MAX = 0.0
#: Fracción del ajuste por tendencia de minutos que se aplica. A tope metía un
#: sesgo de +0,22 y subía el error; al 30 % mejora a la media desde el 4.º partido.
ROLE_ADJUSTMENT_SCALE = 0.3
#: Encogimiento del rating de equipo hacia la temporada anterior: con n
#: partidos pesa n / (n + k) lo de ahora. Tras la J1 el calendario salía del
#: margen de un único partido.
TEAM_PRIOR_GAMES = 6.0
MIN_GAMES_FOR_TREND = 3   # partidos mínimos antes de fiarse de una tendencia
ROLE_ALERT_MIN_DELTA = 4.0  # minutos de variación para lanzar alerta de rol

#: Encogimiento hacia la temporada anterior. La proyección de un jugador con
#: n partidos esta temporada pesa n / (n + PRIOR_WEIGHT_GAMES) lo de ahora y el
#: resto su media del año pasado. Con 5: tras la jornada 1 manda el pasado
#: (83 %), a la quinta van a medias, a la vigésima pesa lo de ahora un 80 %.
#: Sin esto, un solo partido decidía toda la proyección.
PRIOR_WEIGHT_GAMES = 5.0
#: Partidos mínimos el año pasado para que su media cuente como referencia.
PRIOR_MIN_GAMES = 5
#: Previa de disponibilidad: quien no ha jugado ninguno de sus partidos de esta
#: temporada no proyecta cero de golpe, sino (jugados + k) / (partidos + k).
AVAILABILITY_PRIOR_GAMES = 2.0


def ensure_dirs() -> None:
    """Crea todos los directorios de datos si no existen."""
    for path in (
        RAW_PRICES_DIR,
        RAW_OFFICIAL_DIR,
        season_dir(SEASON_CODE),
        RAW_ROSTER_DIR,
        RAW_INJURIES_DIR,
        PROCESSED_DIR,
        OVERRIDES_DIR,
        WEB_DATA_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
