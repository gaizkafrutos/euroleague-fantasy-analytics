"""Jornada vigente y próximos partidos con el calendario a medias o con aplazados."""
from efa.fixtures import current_round, pending_games, round_progress
from efa.ingest.roster import current_round as roster_round
from efa.projection import next_fixtures


def game(code, rnd, date, played, local="AAA", road="BBB"):
    return {
        "gameCode": code, "round": rnd, "utcDate": date, "played": played,
        "local": {"club": {"code": local}, "score": 80 if played else 0},
        "road": {"club": {"code": road}, "score": 70 if played else 0},
    }


def test_antes_de_empezar_es_la_jornada_uno():
    games = [game(1, 1, "2026-09-24T18:00:00Z", False), game(2, 2, "2026-09-29T18:00:00Z", False)]
    assert current_round(games) == 1
    assert current_round([]) == 1


def test_jornada_a_medias_sigue_siendo_la_vigente():
    games = [
        game(1, 1, "2026-09-24T18:00:00Z", True),
        game(2, 1, "2026-09-25T18:00:00Z", False, "CCC", "DDD"),
        game(3, 2, "2026-09-29T18:00:00Z", False),
    ]
    assert current_round(games) == 1
    assert round_progress(games, 1) == {"games": 2, "played": 1}


def test_jornada_terminada_pasa_a_la_siguiente():
    games = [game(1, 1, "2026-09-24T18:00:00Z", True), game(2, 2, "2026-09-29T18:00:00Z", False)]
    assert current_round(games) == 2
    assert roster_round(games) == 2


def test_un_aplazado_no_congela_la_jornada():
    # El partido 2 de la J1 se aplazó: sigue sin jugar con su fecha de
    # septiembre, y la liga ya va por la J3.
    games = [
        game(1, 1, "2026-09-24T18:00:00Z", True),
        game(2, 1, "2026-09-25T18:00:00Z", False, "CCC", "DDD"),
        game(3, 2, "2026-09-29T18:00:00Z", True, "CCC", "AAA"),
        game(4, 2, "2026-09-30T18:00:00Z", True, "DDD", "BBB"),
        game(5, 3, "2026-10-02T18:00:00Z", False, "CCC", "BBB"),
        game(6, 3, "2026-10-02T19:00:00Z", False, "DDD", "AAA"),
    ]
    assert current_round(games) == 3
    assert [g["gameCode"] for g in pending_games(games)] == [5, 6]
    # Y el aplazado no sale como próximo partido de sus dos clubes.
    fixtures = next_fixtures(games, 3)
    assert fixtures["CCC"] == ("BBB", True)
    assert fixtures["DDD"] == ("AAA", True)
    assert round_progress(games, 1) == {"games": 1, "played": 1}


def test_un_aplazado_ya_con_fecha_nueva_no_devuelve_la_liga_a_su_jornada():
    # El aplazado de la J1 se recoloca en diciembre: está por jugar, pero la
    # jornada vigente es la 3, no la 1.
    games = [
        game(1, 1, "2026-09-24T18:00:00Z", True),
        game(2, 1, "2026-12-15T18:00:00Z", False, "CCC", "DDD"),
        game(3, 2, "2026-09-29T18:00:00Z", True, "CCC", "AAA"),
        game(5, 3, "2026-10-02T18:00:00Z", False, "CCC", "BBB"),
    ]
    assert current_round(games) == 3


def test_temporada_acabada_se_queda_en_la_ultima():
    games = [game(1, 1, "2026-09-24T18:00:00Z", True), game(2, 2, "2026-09-29T18:00:00Z", True)]
    assert current_round(games) == 2


def test_la_lesion_se_mide_contra_el_proximo_partido_de_cada_uno():
    """Con la jornada a medias, "baja en la J12" es baja para quien ya jugó la
    J11 y solo un aviso para quien aún la tiene por jugar."""
    import pandas as pd

    from efa.ingest.injuries import availability_index
    from efa.matching import build_club_alias_map

    clubs = [
        {"code": "BAS", "name": "Baskonia Vitoria-Gasteiz", "abbreviatedName": "Baskonia", "tvCode": "BAS"},
        {"code": "MAD", "name": "Real Madrid", "abbreviatedName": "Real Madrid", "tvCode": "RMB"},
    ]
    market = pd.DataFrame(
        [
            {"fantaking_id": 1, "name": "T. Sedekerskis", "team": "BAS"},
            {"fantaking_id": 2, "name": "S. Llull", "team": "RMB"},
        ]
    )
    report = {
        "source": "prueba",
        "rows": [
            {"name": "Tadas Sedekerskis", "team": "Baskonia Vitoria-Gasteiz", "status": "Out", "round": "Round 12", "comment": "thigh"},
            {"name": "Sergio Llull", "team": "Real Madrid", "status": "Out", "round": "Round 12", "comment": "rest"},
        ],
    }
    index, _ = availability_index(
        market, build_club_alias_map(clubs), 11, reports=[report], round_by_id={1: 12, 2: 11}
    )
    assert index[1]["level"] == "out" and index[1]["label"] == "Baja en la J12"
    assert index[2]["level"] == "probable" and index[2]["label"] == "Baja prevista para la J12"
