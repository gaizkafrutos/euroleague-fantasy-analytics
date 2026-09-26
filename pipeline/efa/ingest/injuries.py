"""Parte de lesiones de la Euroliga, desde BasketNews.

Fuente: https://basketnews.com/news-212393-euroleague-injury-report-updated.html
Una tabla por club con cinco columnas (puesto, jugador, estado, jornada,
comentario) que BasketNews actualiza a diario. Ninguna de las dos APIs del
proyecto trae lesiones ni convocatorias: esto es lo único que cubre ese hueco.

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
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from efa.config import INJURY_OVERRIDES_PATH, INJURY_REPORT_URL, RAW_INJURIES_DIR
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


def fetch_report(url: str = INJURY_REPORT_URL, timeout: int = 30) -> dict[str, Any]:
    """Descarga y parsea el parte. Una sola petición."""
    response = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "euroleague-fantasy-analytics/1.0 (personal, non-commercial)"},
    )
    response.raise_for_status()
    updated, rows = parse_report(response.text)
    if not rows:
        raise RuntimeError(
            "El parte de BasketNews no trae ninguna fila reconocible: la página ha cambiado de forma."
        )
    return {
        "source": SOURCE_NAME,
        "url": url,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": updated,
        "rows": rows,
    }


def save_report(report: dict[str, Any], path: Path = REPORT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def load_report(path: Path = REPORT_PATH) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


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
) -> tuple[dict[int, dict[str, Any]], dict[str, Any]]:
    """fantaking_id -> disponibilidad, y un resumen para `meta.json`."""
    report = report if report is not None else load_report()
    index: dict[int, dict[str, Any]] = {}
    summary: dict[str, Any] = {"source": None, "rows": 0, "matched": 0, "unmatched": []}

    if report:
        matched, unmatched = match_to_market(report.get("rows", []), market, alias_map)
        for row in matched:
            status = classify(row["status"], row["round"], row["comment"], next_round)
            if status is None:
                continue
            index[int(row["fantaking_id"])] = {
                "level": status.level,
                "kind": status.kind,
                "label": status.label,
                "untilRound": status.until_round,
                "detail": row["comment"],
                "reported": f"{row['status']} · {row['round']}",
                "source": report.get("source", SOURCE_NAME),
            }
        summary = {
            "source": report.get("source", SOURCE_NAME),
            "url": report.get("url"),
            "updatedAt": report.get("updatedAt"),
            "fetchedAt": report.get("fetchedAt"),
            "rows": len(report.get("rows", [])),
            "matched": len(matched),
            "unmatched": unmatched,
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
