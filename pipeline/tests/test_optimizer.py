"""El optimizador tiene que respetar las reglas del juego, no solo maximizar."""
from __future__ import annotations

import pytest

from efa.optimizer import Candidate, normalize_position, optimize, suggest_swaps


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Guard", "G"), ("G", "G"), ("PG", "G"), ("SG", "G"), (1, "G"),
        ("Forward", "F"), ("F", "F"), ("PF", "F"), (4, "F"),
        ("Center", "C"), ("C", "C"), (5, "C"),
        ("", None), (None, None), ("Head Coach", None),
    ],
)
def test_normalizacion_de_posiciones(raw, expected):
    assert normalize_position(raw) == expected


def make_pool():
    """Pool amplio: 8 por posición repartidos en 5 clubes."""
    pool = []
    clubs = ["MAD", "BAR", "IST", "PAN", "OLY"]
    for position in ("G", "F", "C"):
        for i in range(8):
            pool.append(
                Candidate(
                    key=f"{position}{i}",
                    name=f"{position} {i}",
                    position=position,
                    club_code=clubs[i % len(clubs)],
                    price=5.0 + i,
                    projection=10.0 + i * 3,
                )
            )
    return pool


def test_respeta_cuotas_de_posicion():
    lineup = optimize(make_pool(), budget=100.0)
    assert lineup is not None
    counts = {p: 0 for p in "GFC"}
    for player in lineup.players:
        counts[player.position] += 1
    assert counts == {"G": 4, "F": 4, "C": 2}


def test_respeta_presupuesto():
    lineup = optimize(make_pool(), budget=80.0)
    assert lineup is not None
    assert lineup.total_price <= 80.0


def test_respeta_maximo_por_club():
    pool = [
        Candidate(f"{p}{i}", f"{p}{i}", p, "MAD", 5.0, 20.0 - i)
        for p in "GFC"
        for i in range(8)
    ] + [
        Candidate(f"x{p}{i}", f"x{p}{i}", p, "BAR", 5.0, 5.0)
        for p in "GFC"
        for i in range(8)
    ]
    lineup = optimize(pool, budget=100.0, max_per_club=6)
    assert lineup is not None
    from collections import Counter

    counts = Counter(p.club_code for p in lineup.players)
    assert all(count <= 6 for count in counts.values())


def test_el_capitan_es_el_mayor_proyectado():
    lineup = optimize(make_pool(), budget=100.0)
    assert lineup is not None
    assert lineup.captain is not None
    assert lineup.captain.projection == max(p.projection for p in lineup.players)


def test_jugadores_bloqueados_entran_siempre():
    lineup = optimize(make_pool(), budget=100.0, locked=["G0"])
    assert lineup is not None
    assert any(p.key == "G0" for p in lineup.players)


def test_jugadores_excluidos_no_entran():
    lineup = optimize(make_pool(), budget=100.0, excluded=["G7"])
    assert lineup is not None
    assert all(p.key != "G7" for p in lineup.players)


def test_presupuesto_imposible_devuelve_none():
    assert optimize(make_pool(), budget=1.0) is None


def test_ilp_no_es_peor_que_la_heuristica():
    from efa.optimizer import _optimize_greedy, _optimize_ilp

    pool = make_pool()
    ilp = _optimize_ilp(pool, 90.0, set(), 6)
    greedy = _optimize_greedy(pool, 90.0, set(), 6)
    assert ilp is not None and greedy is not None
    assert ilp.total_projection >= greedy.total_projection - 1e-6


def test_sugerencias_respetan_presupuesto_y_posicion():
    pool = make_pool()
    current = [pool[0], pool[8], pool[16]]  # un G, un F, un C baratos y flojos
    suggestions = suggest_swaps(current, pool, budget_free=3.0)
    assert suggestions
    for suggestion in suggestions:
        assert suggestion["gain"] > 0
        assert suggestion["costDelta"] <= 3.0 + 1e-9


def test_sin_sugerencias_si_ya_tienes_lo_mejor():
    pool = make_pool()
    best_guards = sorted([c for c in pool if c.position == "G"], key=lambda c: -c.projection)
    suggestions = suggest_swaps([best_guards[0]], pool, budget_free=0.0)
    assert suggestions == []
