"""La comprobación de la fórmula contra el juego: qué cuenta como cuadrar."""
import json

import pandas as pd

from efa import verify


def _frames(market_pf: float, fouls: list[int]):
    market = pd.DataFrame(
        [{"fantaking_id": 1, "fpt": 10.0, "pts": 10.0, "pf": market_pf}]
    )
    crosswalk = pd.DataFrame([{"fantaking_id": 1, "person_code": "A", "club_code": "X"}])
    gamelog = pd.DataFrame(
        [
            {"person_code": "A", "played": True, "points": 10.0, "fouls_committed": f}
            for f in fouls
        ]
    )
    return market, crosswalk, gamelog


def test_un_redondeo_de_la_media_no_es_un_descuadre():
    # 7 faltas en 3 partidos: 2,333 de media, que el juego enseña como 2,3.
    market, crosswalk, gamelog = _frames(2.3, [2, 2, 3])
    assert verify._actions(market, crosswalk, gamelog)["pf"]["playersOff"] == 0
    assert verify._foul_gap(market, crosswalk, gamelog) == {"players": 0, "fouls": 0}


def test_una_falta_que_el_juego_no_conto_se_cuenta_aparte():
    # El acta dice 3+3+3 = 9; el juego, 2,7 de media (8 en total): una menos.
    market, crosswalk, gamelog = _frames(2.7, [3, 3, 3])
    assert verify._actions(market, crosswalk, gamelog)["pf"]["playersOff"] == 1
    assert verify._foul_gap(market, crosswalk, gamelog) == {"players": 1, "fouls": 1}


def test_faltas_de_mas_en_el_juego_no_son_el_hueco_conocido():
    market, crosswalk, gamelog = _frames(3.3, [3, 3, 3])
    assert verify._foul_gap(market, crosswalk, gamelog)["players"] == 0


def test_el_resumen_se_guarda_sin_la_lista_de_casos(tmp_path, monkeypatch):
    monkeypatch.setattr(verify, "PROCESSED_DIR", tmp_path)
    verify.save_report({"ok": True, "skipped": False, "players": 10, "exact": 9, "worstMatches": [1, 2]})
    saved = json.loads((tmp_path / verify.REPORT_NAME).read_text(encoding="utf-8"))
    assert saved["exact"] == 9 and "worstMatches" not in saved
    assert verify.load_report()["players"] == 10


def test_una_comprobacion_saltada_no_pisa_la_anterior(tmp_path, monkeypatch):
    monkeypatch.setattr(verify, "PROCESSED_DIR", tmp_path)
    verify.save_report({"ok": True, "skipped": False, "players": 10})
    verify.save_report({"ok": False, "skipped": True, "reason": "sin captura"})
    assert verify.load_report()["players"] == 10


def test_los_clubes_que_acaban_de_jugar_se_dejan_para_la_siguiente_captura():
    """El juego puntúa en directo y el acta oficial sale al acabar: con la
    captura pegada a los partidos, las dos fuentes no hablan de lo mismo."""

    def game(date, local, road, played=True):
        return {"utcDate": date, "played": played, "local": {"club": {"code": local}}, "road": {"club": {"code": road}}}

    games = [
        game("2026-11-06T19:30:00Z", "VIR", "DUB"),
        game("2026-11-11T19:45:00Z", "PAR", "BAS"),
        game("2026-11-12T19:05:00Z", "TEL", "HTA"),
        # En juego al capturar: la API aún no lo da por jugado, el juego ya puntúa.
        game("2026-11-12T20:00:00Z", "MAD", "RED", played=False),
        game("2026-11-13T19:30:00Z", "ASV", "BES", played=False),
    ]
    # A las 21:57 del 12: los de esta noche (acabado o en juego) no se comparan;
    # los de ayer (26 h antes) sí, y los de mañana no han empezado.
    assert verify.clubs_settling(games, "2026-11-12T21:57:54Z") == {"TEL", "HTA", "MAD", "RED"}
    # A las 00:50 del 12, cinco horas después de los partidos del 11.
    assert verify.clubs_settling(games, "2026-11-12T00:50:28Z") == {"PAR", "BAS"}
    assert verify.clubs_settling(games, "2026-11-10T09:00:00Z") == set()
    assert verify.clubs_settling([], "2026-11-12T21:57:54Z") == set()
    assert verify.clubs_settling(games, None) == set()
