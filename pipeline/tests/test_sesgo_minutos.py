"""Sesgo de la proyección en la 2026-27 (auditoría del 17 de octubre de 2026).

Lo publicado sobreestimaba en todas las jornadas: los minutos del año pasado no
contaban con que esta temporada las rotaciones son más largas. Ahora los
minutos de referencia se escalan por el cambio del minuto medio de la liga.
"""
from __future__ import annotations

from dataclasses import replace

import pandas as pd
import pytest

from efa.projection import PARAMS, project


def _games(minutes: float, players: int, prefix: str, date: str) -> pd.DataFrame:
    return pd.DataFrame({
        "person_code": [f"{prefix}{i}" for i in range(players)],
        "game_code": range(players),
        "utc_date": pd.Timestamp(date, tz="UTC"),
        "opponent_code": "XXX",
        "is_home": [i % 2 == 0 for i in range(players)],
        "played": True,
        "minutes": minutes,
        "fantasy_points": minutes * 0.5,
    })


def test_los_minutos_del_ano_pasado_se_escalan_con_la_liga():
    # El año pasado se jugaban 20 min por partido; esta temporada, 18 (-10 %).
    prior = pd.concat([_games(20.0, 200, "p", "2025-10-01"), _games(30.0, 5, "star", "2025-10-02")])
    prior.loc[prior["person_code"].str.startswith("star"), "person_code"] = "star"
    history = _games(18.0, 200, "n", "2026-10-01")
    target = pd.DataFrame({"person_code": ["star"], "opponent_code": ["XXX"], "is_home": [True]})
    league = prior["minutes"].mean()
    scale = 18.0 / league

    with_scale = project(target, history, prior, {}, PARAMS)
    without = project(target, history, prior, {}, replace(PARAMS, league_minutes_scale=False))
    assert without["minutes"].iloc[0] == pytest.approx(30.0)
    assert with_scale["minutes"].iloc[0] == pytest.approx(30.0 * scale)


def test_sin_jornada_completa_no_se_escala():
    prior = _games(20.0, 200, "p", "2025-10-01")
    prior.loc[0, ["person_code", "minutes"]] = ["star", 30.0]
    prior = pd.concat([prior] + [prior.iloc[[0]]] * 4)
    history = _games(15.0, 20, "n", "2026-10-01")  # menos de 150 actuaciones
    target = pd.DataFrame({"person_code": ["star"], "opponent_code": ["XXX"], "is_home": [True]})
    assert project(target, history, prior, {}, PARAMS)["minutes"].iloc[0] == pytest.approx(30.0)
