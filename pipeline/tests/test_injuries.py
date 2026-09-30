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


# ---------------------------------------------------------------------------
# Fuentes de respaldo y combinación
# ---------------------------------------------------------------------------
SPHERE_HTML = """
<p>Last updated: 26 September 2026, 17:00</p>
<table><tr><th>Player</th><th>Team</th><th>Injury</th><th>Status</th><th>Back for</th></tr>
<tr><td class="bs-inj-p"><a href="#">Kendrick Nunn</a></td><td><span><img alt="Panathinaikos"><a>Panathinaikos</a></span></td>
    <td>Meniscus</td><td><span class="bs-inj-s bs-inj-out">Out</span></td><td>2 weeks</td></tr>
<tr><td>Usman Garuba</td><td>Real Madrid</td><td>ACL</td><td>Out</td><td>Several months</td></tr>
<tr><td>Nick Smith Jr.</td><td>Real Madrid</td><td>–</td><td>Cleared</td><td>Round 1 25 Sep</td></tr>
<tr><td>Tony Parker</td><td>Real Madrid</td><td>Not included in 12-man roster</td><td>Out</td><td>Unconfirmed</td></tr>
<tr><td>Moustapha Fall</td><td>Panathinaikos</td><td>Hamstring injury</td><td>Out</td><td>Unconfirmed</td></tr>
<tr><td>Joffrey Lauvergne</td><td>Panathinaikos</td><td>Calf injury</td><td>Out</td><td>Round 4</td></tr>
</table>
<table><tr><th>Status</th><th>What it means</th></tr><tr><td>Out</td><td>...</td></tr></table>
"""


def test_parsea_basketball_sphere():
    from efa.ingest.injuries import parse_sphere

    updated, rows = parse_sphere(SPHERE_HTML)
    assert updated == "2026-09-26T17:00:00"
    by_name = {r["name"]: r for r in rows}
    assert by_name["Kendrick Nunn"] == {
        "team": "Panathinaikos", "position": "", "name": "Kendrick Nunn",
        "status": "Out", "round": "", "comment": "Meniscus",
    }
    assert by_name["Usman Garuba"]["round"] == "Indefinitely"
    assert by_name["Nick Smith Jr."]["status"] == "Ready" and by_name["Nick Smith Jr."]["round"] == "Round 1"
    # "Out" sin fecha de vuelta habla del último partido: duda para la próxima.
    assert by_name["Moustapha Fall"]["status"] == "Uncertain"
    # "Back for: Round 4": baja hasta la J3.
    lauvergne = by_name["Joffrey Lauvergne"]
    assert (lauvergne["status"], lauvergne["round"]) == ("Out", "Round 1-3")
    assert classify(lauvergne["status"], lauvergne["round"], "", 2).until_round == 3
    # Fuera de la convocatoria de la jornada pasada: duda, no baja.
    parker = by_name["Tony Parker"]
    assert parker["status"] == "Uncertain"
    assert classify(parker["status"], parker["round"], parker["comment"], 2).level == "doubt"


def test_parsea_rotowire():
    from efa.ingest.injuries import parse_rotowire

    rows = parse_rotowire([
        {"player": "Kamar Baldwin", "team": "BAY", "position": "G", "injury": "Undisclosed", "status": "Game Time Decision"},
        {"player": "Shane Larkin", "team": "IST", "position": "G", "injury": "Knee", "status": "OUT"},
        {"player": "Nadie", "team": "BAY", "position": "G", "injury": "", "status": "Active"},
    ])
    assert [(r["name"], r["status"], r["comment"]) for r in rows] == [
        ("Kamar Baldwin", "Game time", ""),
        ("Shane Larkin", "Out", "Knee"),
    ]
    assert classify(rows[0]["status"], "", "", 2).level == "doubt"


def test_la_fuente_prioritaria_decide_y_las_demas_suman():
    from efa.ingest.injuries import availability_index

    market = pd.DataFrame({
        "fantaking_id": [1, 2, 3, 4],
        "name": ["K. Nunn", "M. Fall", "N. Smith Jr", "U. Garuba"],
        "team": ["PAO", "PAO", "RMB", "RMB"],
    })
    first = {"source": "A", "fetchedAt": "2026-09-26T10:00:00+00:00", "rows": [
        {"team": "Real Madrid", "position": "", "name": "Nick Smith Jr.", "status": "Ready", "round": "", "comment": ""},
        {"team": "Panathinaikos AKTOR Athens", "position": "", "name": "Kendrick Nunn", "status": "Uncertain", "round": "Round 2", "comment": ""},
    ]}
    second = {"source": "B", "fetchedAt": "2026-09-26T11:00:00+00:00", "rows": [
        {"team": "Real Madrid", "position": "", "name": "Nick Smith Jr.", "status": "Out", "round": "", "comment": ""},
        {"team": "Panathinaikos", "position": "", "name": "Kendrick Nunn", "status": "Out", "round": "", "comment": ""},
        {"team": "Panathinaikos", "position": "", "name": "Moustapha Fall", "status": "Out", "round": "Round 2-3", "comment": ""},
    ]}
    index, summary = availability_index(market, build_club_alias_map(CLUBS), 2, reports=[first, second])
    # A dice que Smith está listo: B no puede contradecirle con una baja.
    assert index[3]["level"] == "probable" and index[3]["source"] == "A"
    # A tiene a Nunn en duda: manda A.
    assert index[1]["level"] == "doubt" and index[1]["source"] == "A"
    # Fall solo sale en B: se añade.
    assert index[2]["level"] == "out" and index[2]["source"] == "B"
    assert summary["source"] == "A + B"
    assert summary["fetchedAt"] == "2026-09-26T11:00:00+00:00"


def test_un_parte_viejo_no_se_usa(tmp_path, monkeypatch):
    import json

    from efa.ingest import injuries

    monkeypatch.setattr(injuries, "RAW_INJURIES_DIR", tmp_path)
    for key, fetched in (("basketnews", "2026-09-20T10:00:00+00:00"), ("rotowire", "2026-09-26T10:00:00+00:00")):
        (tmp_path / f"{key}.json").write_text(json.dumps({"source": key, "fetchedAt": fetched, "rows": []}))
    assert [r["source"] for r in injuries.load_reports()] == ["rotowire"]


def test_reintenta_ante_un_403(monkeypatch):
    from efa.ingest import injuries

    calls = {"n": 0}

    class Response:
        def __init__(self, status):
            self.status_code, self.ok, self.text = status, status == 200, "ok"

    def fake_get(url, timeout, headers):
        calls["n"] += 1
        return Response(403 if calls["n"] == 1 else 200)

    monkeypatch.setattr(injuries.requests, "get", fake_get)
    monkeypatch.setattr(injuries.time, "sleep", lambda s: None)
    assert injuries._get("https://x").text == "ok"
    assert calls["n"] == 2
