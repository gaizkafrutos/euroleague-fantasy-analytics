"""El cruce de identidades es el punto donde un error silencioso hace más daño:
atribuir las estadísticas de un jugador a otro no rompe nada, solo miente."""
from __future__ import annotations

from efa.matching import (
    OfficialPlayer,
    PlayerMatcher,
    build_club_alias_map,
    name_signature,
    normalize_name,
    resolve_club,
    strip_accents,
)

CLUBS = [
    {"code": "MAD", "tvCode": "RMB", "name": "Real Madrid", "abbreviatedName": "Real Madrid", "editorialName": "Real", "country": {"code": "ESP"}},
    {"code": "BAR", "tvCode": "BAR", "name": "FC Barcelona", "abbreviatedName": "FC Barcelona", "editorialName": "Barca", "country": {"code": "ESP"}},
    {"code": "IST", "tvCode": "EFS", "name": "Anadolu Efes Istanbul", "abbreviatedName": "Anadolu Efes", "editorialName": "Efes", "country": {"code": "TUR"}},
    {"code": "PAN", "tvCode": "PAO", "name": "Panathinaikos AKTOR Athens", "abbreviatedName": "Panathinaikos", "editorialName": "Panathinaikos", "country": {"code": "GRE"}},
]


def official(code, name, club, position="Guard", passport_name=None):
    """Registro del censo oficial. `name` va como "APELLIDO, NOMBRE"; el feed
    real separa además apellido y nombre de pasaporte en campos propios."""
    surname, given = (name.split(",", 1) + [""])[:2]
    return OfficialPlayer.from_feed(
        {
            "person": {
                "code": code,
                "name": name,
                "images": {},
                "passportSurname": surname.strip(),
                "passportName": (passport_name or given).strip(),
            },
            "club": {"code": club},
            "positionName": position,
            "type": "J",
        }
    )


ROSTER = [
    official("001", "JONES, DAMIAN", "MAD", "Center"),
    official("002", "HEZONJA, MARIO", "MAD", "Forward"),
    official("003", "MIROTIC, NIKOLA", "MAD", "Forward"),
    official("004", "SATORANSKY, TOMAS", "BAR", "Guard"),
    official("005", "VESELY, JAN", "BAR", "Center"),
    official("006", "LARKIN, SHANE", "IST", "Guard"),
    official("007", "PAPAPETROU, IOANNIS", "PAN", "Forward"),
    official("008", "NUNN, KENDRICK", "PAN", "Guard"),
]


def test_strip_accents():
    assert strip_accents("Nikola Mirotić") == "Nikola Mirotic"
    assert strip_accents("Çağlar") == "Caglar"


def test_normalizacion_ignora_orden_y_coma():
    assert normalize_name("JONES, DAMIAN") == "JONES DAMIAN"
    assert normalize_name("Damian Jones") == "DAMIAN JONES"
    assert name_signature("JONES, DAMIAN")[0] == name_signature("Damian Jones")[0]


def test_normalizacion_quita_sufijos():
    assert "JR" not in normalize_name("Gary Trent Jr.")


def test_resolver_club_por_alias():
    alias_map = build_club_alias_map(CLUBS)
    for raw in ("Real Madrid", "REAL", "RMB", "MAD", "Real  Madrid "):
        assert resolve_club(raw, alias_map) == "MAD"
    assert resolve_club("Efes", alias_map) == "IST"
    assert resolve_club("Anadolu Efes", alias_map) == "IST"
    assert resolve_club("Barca", alias_map) == "BAR"


def matcher():
    return PlayerMatcher(ROSTER, build_club_alias_map(CLUBS))


def test_match_exacto_orden_invertido():
    result = matcher().match(1, "Damian Jones", "Real Madrid")
    assert result.person_code == "001"
    assert result.method == "initial-club"


def test_match_con_acentos():
    result = matcher().match(2, "Nikola Mirotić", "Real Madrid")
    assert result.person_code == "003"


def test_match_por_inicial():
    result = matcher().match(3, "S. Larkin", "Efes")
    assert result.person_code == "006"
    assert result.method == "initial-club"


def test_match_solo_apellido():
    result = matcher().match(4, "Satoransky", "Barca")
    assert result.person_code == "004"


def test_match_fuzzy_tolera_erratas():
    result = matcher().match(5, "Papapetru, Ioannis", "Panathinaikos")
    assert result.person_code == "007"


def test_desconocido_queda_sin_emparejar():
    result = matcher().match(6, "Fulanito De Tal", "Real Madrid")
    assert result.person_code is None
    assert result.method == "unmatched"


def test_override_manual_gana_siempre():
    m = PlayerMatcher(ROSTER, build_club_alias_map(CLUBS), overrides={7: "005"})
    result = m.match(7, "Damian Jones", "Real Madrid")
    assert result.person_code == "005"
    assert result.method == "override"


def test_match_aunque_el_equipo_no_cuadre():
    """Un fichaje reciente puede aparecer con el equipo antiguo en una fuente."""
    result = matcher().match(8, "Kendrick Nunn", "Real Madrid")
    assert result.person_code == "008"
    assert result.method.endswith("open")


# ---------------------------------------------------------------------------
# Formatos reales, comprobados contra el mercado del 14/09/2026
# ---------------------------------------------------------------------------
REAL_ROSTER = [
    # Vezenkov figura como SASHA en el nombre deportivo y ALEKSANDAR en el pasaporte.
    official("100", "VEZENKOV, SASHA", "OLY", "Forward", passport_name="ALEKSANDAR"),
    official("101", "BROWN, ANTHONY", "BES", "Forward"),
    official("102", "LARKIN, SHANE", "ULK"),
    official("103", "LUWAWU-CABARROT, TIMOTHE", "MAD", "Forward"),
    official("104", "FALL, MOUSTAPHA", "PAN", "Center", passport_name="MOUSTAPHA FALOU"),
]

REAL_CLUBS = CLUBS + [
    {"code": "OLY", "tvCode": "OLY", "name": "Olympiacos Piraeus", "abbreviatedName": "Olympiacos", "editorialName": "Olympiacos", "country": {"code": "GRE"}},
    {"code": "BES", "tvCode": "BJK", "name": "Besiktas Istanbul", "abbreviatedName": "Besiktas", "editorialName": "Besiktas", "country": {"code": "TUR"}},
    {"code": "ULK", "tvCode": "FBT", "name": "Fenerbahce Tarfin Istanbul", "abbreviatedName": "Fenerbahce", "editorialName": "Fenerbahce", "country": {"code": "TUR"}},
]


def real_matcher(prior=None):
    return PlayerMatcher(REAL_ROSTER, build_club_alias_map(REAL_CLUBS), prior_players=prior)


def test_formato_inicial_punto_apellido():
    """Fantaking escribe SIEMPRE "I. Apellido"; es el caso mayoritario."""
    result = real_matcher().match(1, "S. Larkin", "FBT")
    assert result.person_code == "102"
    assert result.method == "initial-club"


def test_equipo_por_tvcode():
    """El mercado identifica al club por su tvCode, no por el código oficial."""
    alias_map = build_club_alias_map(REAL_CLUBS)
    assert resolve_club("FBT", alias_map) == "ULK"
    assert resolve_club("BJK", alias_map) == "BES"
    assert resolve_club("OLY", alias_map) == "OLY"


def test_acepta_nombre_deportivo_y_de_pasaporte():
    """"S. Vezenkov" contra un pasaporte que dice ALEKSANDAR."""
    result = real_matcher().match(2, "S. Vezenkov", "OLY")
    assert result.person_code == "100"


def test_inicial_distinta_no_empareja():
    """El caso que provocó un falso positivo real: "V. Brown" no es Anthony Brown,
    por mucho que sea el único Brown del equipo."""
    result = real_matcher().match(3, "V. Brown", "BJK")
    assert result.person_code is None
    assert result.method == "unmatched"


def test_apellido_compuesto_con_guion():
    result = real_matcher().match(4, "T. Luwawu-Cabarrot", "RMB")
    assert result.person_code == "103"


def test_nombre_de_pasaporte_con_token_del_apellido():
    """Pasaporte "MOUSTAPHA FALOU" para "FALL, MOUSTAPHA": la inicial es M."""
    result = real_matcher().match(5, "M. Fall", "PAO")
    assert result.person_code == "104"


def test_censo_anterior_rescata_al_fichaje_no_inscrito():
    """En pretemporada el censo oficial va a medias. Sin este respaldo, un
    fichaje que aún no figura inscrito se queda sin cruzar."""
    prior = [official("200", "JAMES, MIKE", "MCO")]
    result = real_matcher(prior=prior).match(6, "M. James", "OLY")
    assert result.person_code == "200"
    assert result.method == "prior-season"


def test_el_censo_actual_gana_al_anterior():
    """Si alguien está en los dos censos, manda el de la temporada en curso."""
    prior = [official("999", "LARKIN, SHANE", "IST")]
    result = real_matcher(prior=prior).match(7, "S. Larkin", "FBT")
    assert result.person_code == "102"
