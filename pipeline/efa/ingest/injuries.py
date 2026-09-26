"""Parte de lesiones de la Euroliga, de tres fuentes combinadas.

Ninguna de las dos APIs del proyecto trae lesiones ni convocatorias. Se leen
tres partes públicos, en este orden de prioridad:

  1. BasketNews: una tabla por club (puesto, jugador, estado, jornada,
     comentario), actualizada a diario. El más completo: incluye las dudas.
  2. RotoWire: un JSON con las bajas y las dudas de partido. Sin BasketNews,
     es el que mejor reproduce sus bajas.
  3. Basketball Sphere: una tabla (jugador, club, lesión, estado, vuelta) con
     quién se queda fuera de la convocatoria de 12. Suma dudas.

¿Por qué tres? BasketNews está detrás de Cloudflare, que a veces rechaza (403)
las peticiones que salen de los runners de GitHub según la IP que toque: el
26-09 falló a las 11:54 y a las 12:37 y respondió a las 15:17 desde el mismo
tipo de máquina. No es un problema de credenciales (la página es pública), así
que la solución es no depender de una sola fuente: cada una se guarda por
separado y el build combina las que estén al día.

El flujo tiene tres pasos, separados para poder probarlos sin red:

  1. `parse_report(html)`    HTML -> filas crudas y fecha de actualización.
  2. `classify(...)`         estado + jornada del parte -> nivel para la
                             PRÓXIMA jornada ("out", "doubt", "probable").
  3. `match_to_market(...)`  nombre + club -> `fantaking_id`.

Lo que se guarda en disco es el paso 1, tal cual: si algún día la
clasificación está mal, se rehace desde el crudo sin volver a descargar.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from efa.config import (
    INJURY_OVERRIDES_PATH,
    INJURY_REPORT_URL,
    INJURY_ROTOWIRE_URL,
    INJURY_SPHERE_URL,
    RAW_INJURIES_DIR,
)
from efa.matching import normalize_name, resolve_club, split_market_name

log = logging.getLogger(__name__)

REPORT_PATH = RAW_INJURIES_DIR / "basketnews.json"
SOURCE_NAME = "BasketNews"

#: Cabecera de la tabla buena. La página tiene otra tabla (el selector de
#: equipo) que no lleva jugadores.
_HEADER = ["P", "PLAYER", "STATUS", "ROUND", "COMMENTS"]
_UPDATED = re.compile(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})")
_ROUND_RANGE = re.compile(r"ROUNDS?\s*(\d+)\s*(?:-\s*(\d+))?")


# ---------------------------------------------------------------------------
# 1. HTML -> filas
# ---------------------------------------------------------------------------
class _TableParser(HTMLParser):
    """Recoge todas las tablas como listas de filas de texto."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._depth += 1
            self.tables.append([])
        elif tag == "tr" and self._depth:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self.tables:
                self.tables[-1].append(self._row)
            self._row = None
        elif tag == "table" and self._depth:
            self._depth -= 1

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def parse_report(html: str) -> tuple[str | None, list[dict[str, str]]]:
    """Extrae (fecha de actualización ISO, filas) del HTML de BasketNews.

    Las filas de una sola celda son cabeceras de club; las de cinco, jugadores.
    """
    parser = _TableParser()
    parser.feed(html)

    rows: list[dict[str, str]] = []
    for table in parser.tables:
        header_at = next(
            (i for i, row in enumerate(table) if [c.upper() for c in row[-5:]] == _HEADER), None
        )
        if header_at is None:
            continue
        team = ""
        for row in table[header_at + 1 :]:
            cells = [c for c in row if c is not None]
            if len(cells) == 1 and cells[0]:
                team = cells[0]
            elif len(cells) >= 5 and team:
                position, name, status, round_text, comment = cells[-5:]
                if name:
                    rows.append(
                        {
                            "team": team,
                            "position": position,
                            "name": " ".join(name.split()),
                            "status": status,
                            "round": round_text,
                            "comment": comment,
                        }
                    )
        if rows:
            break

    updated = None
    match = _UPDATED.search(html[html.upper().find("INJURY REPORT") :] if "INJURY REPORT" in html.upper() else html)
    if match:
        updated = f"{match.group(1)}T{match.group(2)}:00"
    return updated, rows


_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _get(url: str, *, timeout: int = 30, attempts: int = 3, pause: float = 8.0) -> requests.Response:
    """GET con cabeceras de navegador y reintentos ante 403/429/5xx o red caída.

    El bloqueo de Cloudflare depende de la IP y del momento: un segundo intento
    unos segundos después a veces pasa.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.get(url, timeout=timeout, headers=_BROWSER_HEADERS)
            if response.ok:
                return response
            last = requests.HTTPError(f"{response.status_code} en {url}", response=response)
            if response.status_code not in {403, 429} and response.status_code < 500:
                break
        except requests.RequestException as exc:
            last = exc
        if attempt < attempts:
            time.sleep(pause * attempt)
    assert last is not None
    raise last


def _report(source: str, url: str, updated: str | None, rows: list[dict[str, str]]) -> dict[str, Any]:
    if not rows:
        raise RuntimeError(f"El parte de {source} no trae ninguna fila reconocible: la página ha cambiado.")
    return {
        "source": source,
        "url": url,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": updated,
        "rows": rows,
    }


def fetch_report(url: str = INJURY_REPORT_URL, timeout: int = 30) -> dict[str, Any]:
    """BasketNews. Una sola petición (más los reintentos)."""
    updated, rows = parse_report(_get(url, timeout=timeout).text)
    return _report(SOURCE_NAME, url, updated, rows)


# ---------------------------------------------------------------- Basketball Sphere
_SPHERE_HEADER = ["PLAYER", "TEAM", "INJURY", "STATUS", "BACK FOR"]
_SPHERE_UPDATED = re.compile(r"Last updated:\s*(\d{1,2}) (\w+) (\d{4}),?\s*(\d{1,2}):(\d{2})")
_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}
#: Sus cuatro estados, traducidos al vocabulario de BasketNews que entiende `classify`.
_SPHERE_STATUS = {"out": "Out", "doubtful": "Doubtful", "day to day": "Questionable", "cleared": "Ready"}


def _sphere_round(back: str) -> str:
    """"Round 3 1 Oct" -> "Round 3"; meses o temporada -> "Indefinitely"; resto -> ""."""
    text = back or ""
    match = re.search(r"Round\s*(\d+)(?:\s*-\s*(\d+))?", text, re.I)
    if match:
        return f"Round {match.group(1)}" + (f"-{match.group(2)}" if match.group(2) else "")
    if re.search(r"month|season|indefinite|long", text, re.I):
        return "Indefinitely"
    return ""


def _sphere_out(injury: str, back: str) -> tuple[str, str]:
    """El "Out" de Basketball Sphere habla del último partido; "Back for" dice cuándo vuelve.

    Contrastado con BasketNews el 26-09: sin fecha de vuelta, sus "Out" eran
    "Uncertain" en BasketNews (se perdieron la J1, la J2 está en el aire).
      - fuera de la convocatoria de 12             -> duda (decisión técnica)
      - "Back for: Round N"                        -> baja hasta la N-1
      - una duración ("2 weeks", "several months") -> baja
      - sin fecha ("Unconfirmed")                  -> duda
    """
    if re.search(r"12-man|not included|roster", injury or "", re.I):
        return "Uncertain", ""
    match = re.search(r"Round\s*(\d+)", back or "", re.I)
    if match:
        last_missed = int(match.group(1)) - 1
        # "Round 1-N": lo que cuenta para `classify` es hasta cuándo.
        return ("Out", f"Round 1-{last_missed}") if last_missed >= 1 else ("Ready", "")
    if re.search(r"week|month|season|indefinite|long", back or "", re.I):
        return "Out", _sphere_round(back)
    return "Uncertain", ""


def parse_sphere(html: str) -> tuple[str | None, list[dict[str, str]]]:
    """Tabla general de Basketball Sphere -> (fecha ISO, filas en el formato de BasketNews)."""
    parser = _TableParser()
    parser.feed(html)
    rows: list[dict[str, str]] = []
    for table in parser.tables:
        if not table or [c.upper() for c in table[0]] != _SPHERE_HEADER:
            continue
        for cells in table[1:]:
            if len(cells) < 5 or not cells[0]:
                continue
            name, team, injury, status, back = cells[:5]
            mapped = _SPHERE_STATUS.get(status.strip().lower())
            if not mapped:
                continue
            round_text = _sphere_round(back)
            if mapped == "Out":
                mapped, round_text = _sphere_out(injury, back)
            rows.append({
                "team": team,
                "position": "",
                "name": " ".join(name.split()),
                "status": mapped,
                "round": round_text,
                "comment": injury if injury not in {"–", "-"} else "",
            })
        break
    updated = None
    match = _SPHERE_UPDATED.search(html)
    if match and match.group(2).lower() in _MONTHS:
        day, month, year, hour, minute = match.groups()
        updated = f"{year}-{_MONTHS[month.lower()]:02d}-{int(day):02d}T{int(hour):02d}:{minute}:00"
    return updated, rows


def fetch_sphere(url: str = INJURY_SPHERE_URL) -> dict[str, Any]:
    updated, rows = parse_sphere(_get(url).text)
    return _report("Basketball Sphere", url, updated, rows)


# ------------------------------------------------------------------------ RotoWire
_ROTOWIRE_STATUS = {"out": "Out", "game time decision": "Game time", "questionable": "Questionable",
                    "doubtful": "Doubtful", "probable": "Probable"}


def parse_rotowire(payload: list[dict[str, Any]]) -> list[dict[str, str]]:
    """JSON de RotoWire -> filas. El club viene con el código de Fantaking (BAY, CZV...)."""
    rows: list[dict[str, str]] = []
    for item in payload:
        mapped = _ROTOWIRE_STATUS.get(str(item.get("status", "")).strip().lower())
        name = " ".join(str(item.get("player", "")).split())
        if not mapped or not name:
            continue
        injury = str(item.get("injury") or "")
        rows.append({
            "team": str(item.get("team") or ""),
            "position": str(item.get("position") or ""),
            "name": name,
            "status": mapped,
            "round": "",
            "comment": "" if injury == "Undisclosed" else injury,
        })
    return rows


def fetch_rotowire(url: str = INJURY_ROTOWIRE_URL) -> dict[str, Any]:
    return _report("RotoWire", url, None, parse_rotowire(_get(url).json()))


# ------------------------------------------------------------------------ Todas
#: (clave del fichero, función). El orden es la prioridad cuando discrepan.
#: Medido el 26-09 contra BasketNews: sin él, RotoWire primero recoge sus 15
#: bajas (15/15); Basketball Sphere primero, 4 (sus "Out" sin fecha de vuelta
#: mezclan lesiones largas con quien solo se perdió el último partido).
SOURCES: list[tuple[str, Any]] = [
    ("basketnews", fetch_report),
    ("rotowire", fetch_rotowire),
    ("basketballsphere", fetch_sphere),
]
#: Un parte descargado más de estas horas antes que el más reciente no se usa.
FRESH_HOURS = 48


def report_path(key: str) -> Path:
    return RAW_INJURIES_DIR / f"{key}.json"


def fetch_all(save: bool = True) -> dict[str, dict[str, Any] | Exception]:
    """Descarga las tres fuentes; cada fallo se devuelve, no se lanza."""
    results: dict[str, dict[str, Any] | Exception] = {}
    for key, fetch in SOURCES:
        try:
            report = fetch()
        except Exception as exc:  # noqa: BLE001 - una fuente caída no tumba las demás
            log.warning("Parte de %s no disponible: %s", key, exc)
            results[key] = exc
            continue
        if save:
            save_report(report, report_path(key))
        results[key] = report
    return results


def save_report(report: dict[str, Any], path: Path = REPORT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def load_report(path: Path = REPORT_PATH) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_reports() -> list[dict[str, Any]]:
    """Los partes guardados que siguen al día, en orden de prioridad."""
    reports = [r for key, _ in SOURCES if (r := load_report(report_path(key)))]
    stamps = [pd.to_datetime(r.get("fetchedAt"), utc=True, errors="coerce") for r in reports]
    valid = [s for s in stamps if not pd.isna(s)]
    if not valid:
        return reports
    newest = max(valid)
    return [
        r for r, s in zip(reports, stamps, strict=True)
        if not pd.isna(s) and s >= newest - pd.Timedelta(hours=FRESH_HOURS)
    ]


# ---------------------------------------------------------------------------
# 2. Estado -> nivel para la próxima jornada
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Availability:
    #: "out" (no juega), "doubt" (en el aire), "probable" (se espera que juegue).
    level: str
    #: "injury", "coach" (decisión técnica), "roster" (fuera de la convocatoria).
    kind: str
    #: Última jornada que se pierde, si el parte la concreta.
    until_round: int | None
    #: Frase corta para la web, en castellano.
    label: str


def _round_span(round_text: str) -> tuple[int | None, int | None, bool]:
    """"Round 2-4" -> (2, 4, False); "Indefinitely"/"Long-term" -> (None, None, True)."""
    text = (round_text or "").upper()
    if "INDEFINITE" in text or "LONG" in text or "SEASON" in text:
        return None, None, True
    match = _ROUND_RANGE.search(text)
    if not match:
        return None, None, False
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else start
    return start, end, False


def _kind(comment: str) -> str:
    text = (comment or "").lower()
    if "coach" in text:
        return "coach"
    if "roster" in text or "out of the squad" in text or "not included" in text:
        return "roster"
    return "injury"


def classify(status: str, round_text: str, comment: str, next_round: int) -> Availability | None:
    """Traduce una fila del parte a lo que importa para fichar en `next_round`.

    La tabla habla a veces de la jornada que ya pasó ("Out · Round 1" leído el
    día después de la jornada 1). Eso no dice que se pierda la siguiente, pero
    tampoco que esté bien: queda como duda.
    """
    state = (status or "").strip().lower()
    start, end, open_ended = _round_span(round_text)
    kind = _kind(comment)

    if state == "out":
        if open_ended:
            label = "Baja indefinida" if kind == "injury" else "Fuera de la convocatoria"
            return Availability("out", kind, None, label)
        if end is not None and end < next_round:
            span = f"en la J{end}" if start == end else f"hasta la J{end}"
            return Availability("doubt", kind, end, f"Baja {span}; sin confirmar para la J{next_round}")
        if start is not None and start > next_round:
            return Availability("probable", kind, end, f"Baja prevista J{start}-J{end}")
        until = end if end is not None else next_round
        label = f"Baja hasta la J{until}" if until > next_round else f"Baja en la J{next_round}"
        return Availability("out", kind, until, label)

    if state in {"uncertain", "questionable", "game-time", "game time", "doubtful"}:
        word = {"doubtful": "Improbable", "questionable": "Al 50 %"}.get(state, "Duda")
        why = " · decisión técnica" if kind == "coach" else ""
        return Availability("doubt", kind, None, f"{word}{why}")

    if state in {"expected", "ready", "probable"}:
        # "Ready · Round 1" leído antes de la jornada 2 ya no aporta nada.
        if end is not None and end < next_round:
            return None
        return Availability("probable", kind, None, "Se espera que juegue")

    return None


# ---------------------------------------------------------------------------
# 3. Nombre + club -> fantaking_id
# ---------------------------------------------------------------------------
def _tokens(name: str) -> list[str]:
    return normalize_name(name).split()


def _fits(
    surname: frozenset[str], initials: frozenset[str], tokens: frozenset[str], first_initial: str
) -> bool:
    """Todo el apellido del mercado está en el nombre del parte y la inicial encaja."""
    if not surname or not surname <= tokens:
        return False
    return not initials or first_initial in initials


def match_to_market(
    rows: list[dict[str, str]],
    market: pd.DataFrame,
    alias_map: dict[str, str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Empareja cada fila del parte con el mercado de Fantaking.

    El parte da nombre completo ("Isaia Cordinier") y el mercado "I. Cordinier".
    Se exige que TODO el apellido del mercado esté en el nombre del parte y que
    la inicial no lo contradiga, primero dentro del club y, si no, en toda la
    liga con resultado único. Se prefiere no emparejar a emparejar mal.
    """
    frame = market[["fantaking_id", "name", "team"]].copy()
    frame["club"] = frame["team"].map(lambda team: resolve_club(str(team), alias_map))
    parsed = [
        (int(row.fantaking_id), row.club, *split_market_name(str(row.name)))
        for row in frame.itertuples()
    ]

    matched: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for row in rows:
        club = resolve_club(row["team"], alias_map)
        tokens = _tokens(row["name"])
        if not tokens:
            continue
        token_set = frozenset(tokens)
        first_initial = tokens[0][0]
        hits = [
            pid
            for pid, c, surname, initials in parsed
            if c == club and _fits(surname, initials, token_set, first_initial)
        ]
        if len(hits) != 1:
            hits = [
                pid
                for pid, _c, surname, initials in parsed
                if _fits(surname, initials, token_set, first_initial)
            ]
        if len(hits) == 1:
            matched.append({**row, "club": club, "fantaking_id": hits[0]})
        else:
            unmatched.append(f"{row['name']} ({row['team']})")
    return matched, unmatched


# ---------------------------------------------------------------------------
# Todo junto, para el build
# ---------------------------------------------------------------------------
def load_injury_overrides(path: Path = INJURY_OVERRIDES_PATH) -> dict[int, dict[str, Any]]:
    """Correcciones manuales: fantaking_id -> nivel y nota. `level=ok` limpia."""
    if not path.exists():
        return {}
    frame = pd.read_csv(path, comment="#", dtype=str).fillna("")
    out: dict[int, dict[str, Any]] = {}
    for row in frame.itertuples():
        try:
            pid = int(row.fantaking_id)
        except (TypeError, ValueError):
            continue
        out[pid] = {"level": row.level.strip().lower(), "label": row.label.strip()}
    return out


def availability_index(
    market: pd.DataFrame,
    alias_map: dict[str, str],
    next_round: int,
    report: dict[str, Any] | None = None,
    reports: list[dict[str, Any]] | None = None,
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    """fantaking_id -> disponibilidad, y un resumen para `meta.json`.

    Con varios partes, manda el primero (en orden de prioridad) que menciona al
    jugador, aunque sea para decir que ya está bien: una fuente de menos
    prioridad solo añade a quien las anteriores no nombran.
    """
    if reports is None:
        reports = [report] if report is not None else load_reports()
    index: dict[int, dict[str, Any]] = {}
    summary: dict[str, Any] = {"source": None, "rows": 0, "matched": 0, "unmatched": []}

    decided: set[int] = set()
    sources: list[dict[str, Any]] = []
    unmatched_all: list[str] = []
    for current in reports:
        rows = current.get("rows", [])
        matched, unmatched = match_to_market(rows, market, alias_map)
        added = 0
        for row in matched:
            pid = int(row["fantaking_id"])
            if pid in decided:
                continue
            decided.add(pid)
            status = classify(row["status"], row["round"], row["comment"], next_round)
            if status is None:
                continue
            added += 1
            index[pid] = {
                "level": status.level,
                "kind": status.kind,
                "label": status.label,
                "untilRound": status.until_round,
                "detail": row["comment"],
                "reported": " · ".join(part for part in (row["status"], row["round"]) if part),
                "source": current.get("source", SOURCE_NAME),
            }
        sources.append({
            "source": current.get("source", SOURCE_NAME),
            "url": current.get("url"),
            "updatedAt": current.get("updatedAt"),
            "fetchedAt": current.get("fetchedAt"),
            "rows": len(rows),
            "matched": len(matched),
            "flagged": added,
        })
        unmatched_all.extend(u for u in unmatched if u not in unmatched_all)

    if sources:
        def latest(key: str) -> str | None:
            values = [s[key] for s in sources if s.get(key)]
            return max(values) if values else None

        summary = {
            "source": " + ".join(s["source"] for s in sources),
            "url": sources[0]["url"],
            "updatedAt": latest("updatedAt"),
            "fetchedAt": latest("fetchedAt"),
            "rows": sum(s["rows"] for s in sources),
            "matched": len(decided),
            "unmatched": unmatched_all[:30],
            "sources": sources,
        }

    for pid, override in load_injury_overrides().items():
        if override["level"] == "ok":
            index.pop(pid, None)
        elif override["level"] in {"out", "doubt", "probable"}:
            index[pid] = {
                "level": override["level"],
                "kind": "manual",
                "label": override["label"] or "Corrección manual",
                "untilRound": None,
                "detail": "",
                "reported": "",
                "source": "manual",
            }
    return index, summary
