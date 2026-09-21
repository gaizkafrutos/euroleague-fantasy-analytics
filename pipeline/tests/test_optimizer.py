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

# --- el baremo real del juego -------------------------------------------------


def make_coaches():
    """Cuatro entrenadores con precios y proyecciones distintas."""
    return [
        Candidate("E0", "Barato", "E", "MAD", 5.0, 4.0),
        Candidate("E1", "Medio", "E", "BAR", 7.0, 9.0),
        Candidate("E2", "Caro", "E", "IST", 10.0, 12.0),
        Candidate("E3", "Carisimo", "E", "PAN", 10.0, 1.0),
    ]


def test_el_entrenador_entra_y_cabe_en_el_presupuesto():
    lineup = optimize(make_pool(), budget=100.0, coaches=make_coaches())
    assert lineup is not None
    assert lineup.coach is not None
    # total_price ya incluye al entrenador: la plantilla es alineable.
    assert lineup.total_price <= 100.0 + 1e-9
    assert len(lineup.players) == 10


def test_sin_entrenadores_se_comporta_como_antes():
    lineup = optimize(make_pool(), budget=100.0)
    assert lineup is not None
    assert lineup.coach is None
    assert len(lineup.players) == 10


def test_reparto_de_roles():
    lineup = optimize(make_pool(), budget=100.0, coaches=make_coaches())
    assert lineup is not None
    assert len(lineup.starters) == 5
    assert lineup.sixth is not None
    assert len(lineup.bench) == 4
    claves = [c.key for c in lineup.starters] + [lineup.sixth.key] + [c.key for c in lineup.bench]
    assert len(set(claves)) == 10
    assert lineup.captain in lineup.starters


def test_scored_projection_aplica_los_multiplicadores():
    lineup = optimize(make_pool(), budget=100.0, coaches=make_coaches())
    assert lineup is not None
    esperado = (
        sum(c.projection for c in lineup.starters)
        + lineup.sixth.projection
        + lineup.captain.projection          # el capitán dobla
        + 0.5 * sum(c.projection for c in lineup.bench)
        + lineup.coach.projection
    )
    assert lineup.scored_projection == pytest.approx(esperado)
    # La suma llana no es lo que se juega: el banquillo puntúa a la mitad.
    assert lineup.scored_projection != pytest.approx(lineup.total_projection)


def test_el_ilp_gana_a_la_heuristica_con_el_baremo_real():
    from efa.optimizer import _optimize_greedy, _optimize_ilp

    pool, coaches = make_pool(), make_coaches()
    ilp = _optimize_ilp(pool, 90.0, set(), 6, coaches)
    greedy = _optimize_greedy(pool, 90.0, set(), 6, coaches)
    assert ilp is not None and greedy is not None
    assert ilp.scored_projection >= greedy.scored_projection - 1e-6


def test_el_payload_trae_el_reparto():
    lineup = optimize(make_pool(), budget=100.0, coaches=make_coaches())
    assert lineup is not None
    payload = lineup.as_dict()
    assert len(payload["starters"]) == 5
    assert payload["sixth"]
    assert len(payload["bench"]) == 4
    assert payload["coach"]["key"] == lineup.coach.key
    assert payload["captain"] in payload["starters"]


# ---------------------------------------------------------------- formación
#
# Reglamento, página "Initial team": el quinteto solo admite 2-2-1, 1-2-2,
# 2-1-2, 1-3-1 y 3-1-1 (bases-aleros-pívots). Hasta el 21 sept ni el
# optimizador ni la web lo comprobaban, y el óptimo publicado era alineable
# solo por casualidad.

def _puntuacion(starters, sixth, bench):
    capitan = max(c.projection for c in starters)
    return (
        sum(c.projection for c in starters) + capitan
        + (sixth.projection if sixth else 0.0)
        + 0.5 * sum(c.projection for c in bench)
    )


def _mejor_por_fuerza_bruta(plantilla):
    """Todas las formas de elegir quinteto y sexto, quedándose con la mejor legal."""
    from itertools import combinations

    from efa.optimizer import ALLOWED_FORMATIONS, formation

    mejor = float("-inf")
    for quinteto in combinations(plantilla, 5):
        if formation(quinteto) not in ALLOWED_FORMATIONS:
            continue
        resto = [c for c in plantilla if c not in quinteto]
        for sexto in resto:
            banco = [c for c in resto if c is not sexto]
            mejor = max(mejor, _puntuacion(list(quinteto), sexto, banco))
    return mejor


def test_el_quinteto_del_optimo_respeta_la_formacion():
    """Los seis que más proyectan son bases y aleros: el quinteto tiene que
    meter a un pívot igualmente, aunque proyecte mucho menos."""
    from efa.optimizer import ALLOWED_FORMATIONS, formation

    pool = [Candidate(f"G{i}", f"G{i}", "G", "MAD", 8.0, 30.0 - i) for i in range(6)]
    pool += [Candidate(f"F{i}", f"F{i}", "F", "BAR", 8.0, 28.0 - i) for i in range(6)]
    pool += [Candidate(f"C{i}", f"C{i}", "C", "OLY", 5.0, 6.0 - i) for i in range(4)]
    lineup = optimize(pool, budget=100.0)
    assert lineup is not None
    assert formation(lineup.starters) in ALLOWED_FORMATIONS
    assert any(c.position == "C" for c in lineup.starters)
    assert lineup.captain in lineup.starters
    assert lineup.as_dict()["captain"] in lineup.as_dict()["starters"]


def test_el_reparto_es_el_optimo_de_la_busqueda_exhaustiva():
    """`assign_roles` (y su gemelo en squad.ts) contra todas las combinaciones,
    en 300 plantillas aleatorias con proyecciones muy desiguales por puesto."""
    import random

    from efa.optimizer import ALLOWED_FORMATIONS, assign_roles, formation

    rng = random.Random(21)
    for _ in range(300):
        sesgo = {p: rng.uniform(0, 25) for p in "GFC"}
        plantilla = [
            Candidate(f"{p}{i}", f"{p}{i}", p, "X", 5.0, round(sesgo[p] + rng.uniform(-5, 15), 2))
            for p, n in (("G", 4), ("F", 4), ("C", 2))
            for i in range(n)
        ]
        quinteto, sexto, banco = assign_roles(plantilla)
        assert formation(quinteto) in ALLOWED_FORMATIONS
        assert len(quinteto) == 5 and sexto is not None and len(banco) == 4
        assert _puntuacion(quinteto, sexto, banco) == pytest.approx(_mejor_por_fuerza_bruta(plantilla))


def test_el_ilp_y_el_reparto_cuentan_igual():
    """La puntuación que maximiza el ILP es la que luego publica el Lineup."""
    from efa.optimizer import _optimize_ilp

    pool = [Candidate(f"G{i}", f"G{i}", "G", "MAD", 8.0, 30.0 - i) for i in range(6)]
    pool += [Candidate(f"F{i}", f"F{i}", "F", "BAR", 8.0, 28.0 - i) for i in range(6)]
    pool += [Candidate(f"C{i}", f"C{i}", "C", "OLY", 5.0, 6.0 - i) for i in range(4)]
    lineup = _optimize_ilp(pool, 100.0, set(), 6, [])
    assert lineup is not None
    starters, sixth, bench = lineup.starters, lineup.sixth, lineup.bench
    assert lineup.scored_projection == pytest.approx(_puntuacion(starters, sixth, bench))
