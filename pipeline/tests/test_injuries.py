"""Parte de lesiones: parseo del HTML, lectura del estado y cruce con el mercado."""
from __future__ import annotations

import pandas as pd

from efa.ingest.injuries import classify, match_to_market, parse_report
from efa.matching import build_club_alias_map

HTML = """
<html><head><title>EuroLeague Injury Report (updated daily)</title></head><body>
<h1>EuroLeague Injury Report (updated daily)</h1><span>2026-09-25 20:45</span>
<table><tr><td>Choose a team</td></tr></table>
<table>
 <tr><th>P</th><th>Player</th><th>Status</th><th>Round</th><th>Comments</th></tr>
 <tr><td>Panathinaikos AKTOR Athens</td></tr>
 <tr><td>PG</td><td>Kendrick  Nunn</td><td>Out</td><td>Round 2-4</td><td>Medial right meniscus tear</td></tr>
 <tr><td>C</td><td>Moustapha  Fall</td><td>Uncertain</td><td>Round 2</td><td>DNP in Round 1 ( hamstring injury )</td></tr>
 <tr><td>Real Madrid</td></tr>
 <tr><td>PG</td><td>Nick  Smith Jr.</td><td>Expected</td><td>Round 2</td><td>DNP in Round 1 (not injured)</td></tr>
 <tr><td>PF</td><td>Usman  Garuba</td><td>Out</td><td>Long-term</td><td>Torn ACL</td></tr>
</table></body></html>
"""

CLUBS = [
    {"code": "PAN", "tvCode": "PAO", "name": "Panathinaikos AKTOR Athens"},
    {"code": "MAD", "tvCode": "RMB", "name": "Real Madrid"},
]


def test_parsea_filas_y_fecha():
    updated, rows = parse_report(HTML)
    assert updated == "2026-09-25T20:45:00"
    assert [r["name"] for r in rows] == ["Kendrick Nunn", "Moustapha Fall", "Nick Smith Jr.", "Usman Garuba"]
    assert rows[0]["team"] == "Panathinaikos AKTOR Athens"
    assert rows[3]["team"] == "Real Madrid"


def test_clasifica_para_la_jornada_siguiente():
    assert classify("Out", "Round 2-4", "", 2).level == "out"
    assert classify("Out", "Round 2-4", "", 2).until_round == 4
    assert classify("Out", "Long-term", "Torn ACL", 2).level == "out"
    # Baja de la jornada que ya pasó: no dice que se pierda la siguiente.
    assert classify("Out", "Round 1", "Muscle issue", 2).level == "doubt"
    assert classify("Uncertain", "Round 2", "DNP in Round 1 (coach's decision)", 2).kind == "coach"
    assert classify("Expected", "Round 2", "", 2).level == "probable"
    assert classify("Ready", "Round 1", "Travels with the team", 2) is None
    assert classify("Out", "Indefinitely", "Out of the squad", 2).kind == "roster"


def test_cruza_nombre_completo_con_inicial_y_apellido():
    market = pd.DataFrame(
        {
            "fantaking_id": [1, 2, 3, 4, 5],
            "name": ["K. Nunn", "M. Fall", "N. Smith Jr", "U. Garuba", "T. Parker"],
            "team": ["PAO", "PAO", "RMB", "RMB", "RMB"],
        }
    )
    _, rows = parse_report(HTML)
    matched, unmatched = match_to_market(rows, market, build_club_alias_map(CLUBS))
    assert {r["name"]: r["fantaking_id"] for r in matched} == {
        "Kendrick Nunn": 1,
        "Moustapha Fall": 2,
        "Nick Smith Jr.": 3,
        "Usman Garuba": 4,
    }
    assert unmatched == []


def test_inicial_distinta_no_cruza():
    market = pd.DataFrame({"fantaking_id": [9], "name": ["T. Parker"], "team": ["RMB"]})
    rows = [{"team": "Real Madrid", "name": "Jabari Parker", "status": "Out", "round": "Indefinitely", "comment": ""}]
    matched, unmatched = match_to_market(rows, market, build_club_alias_map(CLUBS))
    assert matched == [] and unmatched == ["Jabari Parker (Real Madrid)"]
