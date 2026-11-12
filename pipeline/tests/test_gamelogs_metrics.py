"""Del boxscore crudo a las señales de decisión, extremo a extremo."""
from __future__ import annotations

import pandas as pd
import pytest

from efa.gamelogs import build_coach_gamelog, build_gamelog, team_minutes_share
from efa.metrics import (
    bargain_score,
    player_performance,
    price_history,
    project_fantasy_points,
    schedule_difficulty,
    team_strength,
)


def stat_line(**overrides):
    base = {
        "timePlayed": 1800.0,
        "points": 10.0,
        "totalRebounds": 4.0,
        "assistances": 2.0,
        "steals": 1.0,
        "turnovers": 2.0,
        "blocksFavour": 0.0,
        "blocksAgainst": 0.0,
        "foulsReceived": 3.0,
        "foulsCommited": 2.0,
        "fieldGoalsMadeTotal": 4.0,
        "fieldGoalsAttemptedTotal": 9.0,
        "freeThrowsMade": 2.0,
        "freeThrowsAttempted": 3.0,
        "startFive": True,
        "plusMinus": 3.0,
        "valuation": 12.0,
    }
    base.update(overrides)
    return base


def player_entry(code, name, **stats):
    return {"player": {"person": {"code": code, "name": name, "images": {}}}, "stats": stat_line(**stats)}


def make_boxscore(local_points, road_points, local_players, road_players):
    return {
        "local": {
            "coach": {"code": "C1", "name": "ENTRENADOR, LOCAL"},
            "players": local_players,
            "total": {"points": local_points},
        },
        "road": {
            "coach": {"code": "C2", "name": "ENTRENADOR, VISITANTE"},
            "players": road_players,
            "total": {"points": road_points},
        },
    }


def make_game(code, round_number, played=True, local_score=0, road_score=0):
    return {
        "gameCode": code,
        "round": round_number,
        "played": played,
        "utcDate": f"2026-10-{round_number:02d}T19:00:00Z",
        "phaseType": {"code": "RS"},
        "local": {"club": {"code": "MAD"}, "score": local_score, "partials": {"extraPeriods": {}}},
        "road": {"club": {"code": "BAR"}, "score": road_score, "partials": {"extraPeriods": {}}},
    }


@pytest.fixture
def dataset():
    games = [make_game(1, 1, True, 90, 80), make_game(2, 2, True, 70, 85)]
    boxscores = {
        1: make_boxscore(
            90, 80,
            [player_entry("001", "ESTRELLA, ANA"), player_entry("002", "SUPLENTE, BEA", timePlayed=600.0, points=2.0)],
            [player_entry("003", "RIVAL, CLARA")],
        ),
        2: make_boxscore(
            70, 85,
            [player_entry("001", "ESTRELLA, ANA", points=20.0), player_entry("002", "SUPLENTE, BEA", timePlayed=0.0, points=0.0, fieldGoalsAttemptedTotal=0.0, freeThrowsAttempted=0.0, totalRebounds=0.0, assistances=0.0, steals=0.0, turnovers=0.0, foulsReceived=0.0, foulsCommited=0.0, fieldGoalsMadeTotal=0.0, freeThrowsMade=0.0)],
            [player_entry("003", "RIVAL, CLARA")],
        ),
    }
    return games, boxscores


def test_gamelog_tiene_una_fila_por_jugador_y_partido(dataset):
    games, boxscores = dataset
    log = build_gamelog(boxscores, games)
    assert len(log) == 6  # 3 jugadores x 2 partidos
    assert set(log["person_code"]) == {"001", "002", "003"}


def test_bonus_de_victoria_solo_para_el_equipo_que_gana(dataset):
    games, boxscores = dataset
    log = build_gamelog(boxscores, games)
    local_j1 = log[(log["game_code"] == 1) & (log["person_code"] == "001")].iloc[0]
    rival_j1 = log[(log["game_code"] == 1) & (log["person_code"] == "003")].iloc[0]
    assert local_j1["team_won"] is True or local_j1["team_won"] == True  # noqa: E712
    assert local_j1["fantasy_win_bonus"] > 0
    assert rival_j1["fantasy_win_bonus"] == 0


def test_dnp_no_cuenta_como_partido_jugado(dataset):
    games, boxscores = dataset
    log = build_gamelog(boxscores, games)
    perf = player_performance(log).set_index("person_code")
    assert perf.loc["002", "games"] == 2
    assert perf.loc["002", "games_played"] == 1
    assert perf.loc["002", "dnp_rate"] == 0.5


def test_la_media_ignora_los_ceros_de_los_dnp(dataset):
    """Un cero por no jugar hundiría la media y mentiría sobre el jugador."""
    games, boxscores = dataset
    log = build_gamelog(boxscores, games)
    perf = player_performance(log).set_index("person_code")
    played_only = log[(log["person_code"] == "002") & (log["played"])]["fantasy_points"]
    assert perf.loc["002", "fp_avg"] == pytest.approx(played_only.mean(), abs=0.01)


def test_cuota_de_minutos_suma_uno_por_equipo_y_partido(dataset):
    games, boxscores = dataset
    log = team_minutes_share(build_gamelog(boxscores, games))
    totals = log.groupby(["game_code", "club_code"])["minutes_share"].sum()
    for value in totals:
        assert value == pytest.approx(1.0) or value == pytest.approx(0.0)


def test_consistencia_entre_cero_y_uno(dataset):
    games, boxscores = dataset
    perf = player_performance(build_gamelog(boxscores, games))
    assert perf["consistency"].between(0, 1).all()


def test_entrenadores_puntuan_por_el_marcador(dataset):
    games, boxscores = dataset
    coaches = build_coach_gamelog(boxscores, games)
    j1_local = coaches[(coaches["game_code"] == 1) & (coaches["person_code"] == "C1")].iloc[0]
    assert j1_local["fantasy_points"] == 10  # gana de 10
    j2_local = coaches[(coaches["game_code"] == 2) & (coaches["person_code"] == "C1")].iloc[0]
    assert j2_local["fantasy_points"] == -10  # pierde de 15


def test_rating_de_equipo_desde_los_resultados(dataset):
    games, _ = dataset
    strength = team_strength(games).set_index("club_code")
    assert strength.loc["MAD", "offense"] == pytest.approx(80.0)
    assert strength.loc["MAD", "defense"] == pytest.approx(82.5)
    assert strength.loc["MAD", "win_rate"] == pytest.approx(0.5)


def test_rating_cae_a_la_temporada_anterior_si_no_hay_partidos():
    prior = pd.DataFrame(
        [{"club_code": "MAD", "offense": 85.0, "defense": 78.0, "win_rate": 0.7, "games": 34, "net_rating": 7.0}]
    )
    strength = team_strength([{"played": False}], prior=prior)
    assert strength["source"].iloc[0] == "temporada anterior"
    assert strength["net_rating"].iloc[0] == 7.0


def test_dificultad_de_calendario_normalizada_a_cien():
    games = [
        make_game(10, 3, played=False),
        make_game(11, 4, played=False),
    ]
    strength = pd.DataFrame(
        [
            {"club_code": "MAD", "net_rating": 8.0},
            {"club_code": "BAR", "net_rating": -3.0},
        ]
    )
    difficulty = schedule_difficulty(games, strength, from_round=3, horizon=2)
    assert set(difficulty["club_code"]) == {"MAD", "BAR"}
    assert difficulty["difficulty"].between(0, 100).all()


def test_proyeccion_usa_la_media_del_mercado_sin_historial():
    table = pd.DataFrame(
        [{"fp_avg": 0.0, "form": 0.0, "games_played": 0, "fpt": 14.0, "minutes_trend": 0.0, "fp_per_min": 0.0}]
    )
    assert project_fantasy_points(table).iloc[0] == pytest.approx(14.0)


def test_proyeccion_no_es_negativa():
    table = pd.DataFrame(
        [{"fp_avg": 1.0, "form": -5.0, "games_played": 20, "fpt": 0.0, "minutes_trend": -10.0, "fp_per_min": 1.0}]
    )
    assert project_fantasy_points(table).iloc[0] >= 0


def test_historial_de_precios_calcula_variaciones():
    snapshots = pd.DataFrame(
        {
            "fantaking_id": [1, 1, 1],
            "quotation": [10.0, 10.5, 11.2],
            "captured_at": pd.to_datetime(["2026-10-01", "2026-10-08", "2026-10-15"], utc=True),
        }
    )
    history = price_history(snapshots).iloc[0]
    assert history["quotation"] == 11.2
    assert history["quotation_open"] == 10.0
    assert history["price_delta_last"] == pytest.approx(0.7)
    assert history["price_delta_total"] == pytest.approx(1.2)
    assert history["snapshots"] == 3


def _market(rows):
    return pd.DataFrame(rows, columns=["projected_fp", "quotation", "is_coach", "play_prob"])


def test_indice_de_chollo_mide_puntos_sobre_lo_normal_a_su_precio():
    from efa.metrics import value_over_price

    # Cuarenta jugadores sobre la recta "un punto por crédito", y tres más.
    rows = [(float(price), float(price), False, 0.95) for price in range(4, 24)] * 2
    rows += [
        (16.0, 10.0, False, 0.95),  # 6 puntos de más a 10 créditos: un chollo
        (10.0, 16.0, False, 0.95),  # 6 de menos a 16 créditos: caro
        (0.0, 12.0, False, 0.0),    # de baja: proyecta 0
    ]
    table = _market(rows)
    surplus = value_over_price(table)
    assert surplus.iloc[40] == pytest.approx(6.0, abs=0.6)
    assert surplus.iloc[41] == pytest.approx(-6.0, abs=0.6)
    scores = bargain_score(table)
    assert scores.between(0, 100).all()
    assert scores.iloc[40] == scores.max()
    # El de baja queda al fondo: proyecta 0 y lo normal a 12 créditos es 12.
    assert scores.iloc[42] == scores.min()
    # Quien está sobre la recta no tiene puntos de más, cueste 4 o 23: no es
    # "puntos por crédito" ni premia al caro por serlo.
    assert abs(surplus.iloc[0]) < 0.6 and abs(surplus.iloc[19]) < 0.6


def test_los_entrenadores_se_ordenan_entre_ellos():
    rows = [(float(price), float(price), False, 0.95) for price in range(4, 24)] * 2
    rows += [(float(points), 8.0, True, 1.0) for points in (-6, -2, 0, 3, 5, 8, 10, 12, 15)]
    scores = bargain_score(_market(rows))
    coaches = scores.iloc[40:]
    assert coaches.is_monotonic_increasing
    assert coaches.iloc[-1] == 100.0


def test_sin_muestra_el_indice_es_neutro():
    scores = bargain_score(_market([(10.0, 8.0, False, 0.95), (5.0, 6.0, False, 0.95)]))
    assert (scores == 50.0).all()


def test_dificultad_de_calendario_es_el_puesto_entre_clubes():
    from efa.metrics import schedule_difficulty

    def fixture(code, rnd, local, road):
        return {"gameCode": code, "round": rnd, "utcDate": f"2026-10-{rnd:02d}T18:00:00Z", "played": False,
                "local": {"club": {"code": local}}, "road": {"club": {"code": road}}}

    strength = pd.DataFrame({"club_code": ["A", "B", "C", "D"], "net_rating": [30.0, 5.0, 1.0, -4.0]})
    # A recibe a B y C recibe a D: B visita al mejor (30 + 2,5 por jugar fuera).
    games = [fixture(1, 5, "A", "B"), fixture(2, 5, "C", "D")]
    table = schedule_difficulty(games, strength, from_round=5).set_index("club_code")
    # Un rival fuera de escala (A, +30) ya no aplasta a los demás contra el cero:
    # con el min-max de antes salían 0, 21, 25 y 100.
    assert table["difficulty"].to_dict() == {"C": 0.0, "D": 33.0, "A": 67.0, "B": 100.0}


def _row(**overrides):
    base = {
        "fp_avg": 30.0, "form": 30.0, "games_played": 1, "games": 1, "club_games": 1,
        "fpt": 30.0, "minutes_trend": 0.0, "fp_per_min": 1.0, "quotation": 10.0,
        "prior_fp_avg": 10.0, "prior_games": 30,
    }
    base.update(overrides)
    return base


def test_un_partido_no_decide_la_proyeccion():
    """Tras la jornada 1 la proyección era el partido de la jornada 1."""
    table = pd.DataFrame([_row()])
    # 1 partido frente a una previa de 5: 1/6 del partido, 5/6 del año pasado.
    assert project_fantasy_points(table).iloc[0] == pytest.approx(30 * 1 / 6 + 10 * 5 / 6, abs=0.3)


def test_sin_jugar_aun_proyecta_su_media_del_ano_pasado():
    """Los clubes que todavía no habían jugado proyectaban 0 en bloque."""
    table = pd.DataFrame([_row(fp_avg=0.0, form=0.0, games_played=0, games=0, club_games=0, fpt=0.0)])
    assert project_fantasy_points(table).iloc[0] == pytest.approx(10.0)


def test_no_convocado_con_su_club_jugando_rebaja_sin_llegar_a_cero():
    table = pd.DataFrame([_row(fp_avg=0.0, form=0.0, games_played=0, games=0, club_games=1, fpt=0.0)])
    # (0 + 2) / (1 + 2) de la previa.
    assert project_fantasy_points(table).iloc[0] == pytest.approx(10.0 * 2 / 3, abs=0.05)


def test_recien_llegado_usa_la_previa_de_su_precio():
    veteranos = [_row(quotation=q, prior_fp_avg=1.5 * q - 3, games_played=0, games=0, club_games=0,
                      fp_avg=0.0, form=0.0, fpt=0.0) for q in range(4, 20) for _ in range(2)]
    nuevo = _row(quotation=12.0, prior_fp_avg=None, prior_games=None, fp_avg=40.0, form=40.0, fpt=40.0)
    table = pd.DataFrame(veteranos + [nuevo])
    esperado = 40 * 1 / 6 + (1.5 * 12 - 3) * 5 / 6
    assert project_fantasy_points(table).iloc[-1] == pytest.approx(esperado, abs=0.3)


def test_en_linea_base_no_hay_encogimiento():
    table = pd.DataFrame([_row(fp_avg=20.0, form=20.0, games_played=30, games=30, club_games=30)])
    assert project_fantasy_points(table, baseline=True).iloc[0] == pytest.approx(20.0)


def test_la_tendencia_de_rol_existe_antes_de_la_sexta_jornada():
    """Con cinco partidos no hay "últimos cinco" frente a "los anteriores":
    la tendencia salía a 0 para todos. Se parte lo jugado por la mitad."""
    minutes = [10.0, 10.0, 10.0, 20.0, 20.0]
    log = pd.DataFrame(
        {
            "person_code": "001",
            "round": range(1, 6),
            "game_code": range(1, 6),
            "played": True,
            "started": False,
            "fantasy_points": 10.0,
            "minutes": minutes,
            "minutes_share": [m / 200 for m in minutes],
        }
    )
    perf = player_performance(log).set_index("person_code")
    assert perf.loc["001", "minutes_trend"] == pytest.approx(10.0)
    assert perf.loc["001", "minutes_share_trend"] == pytest.approx(0.05)
    # La forma y los minutos recientes siguen siendo los de la ventana entera.
    assert perf.loc["001", "minutes_recent"] == pytest.approx(14.0)
