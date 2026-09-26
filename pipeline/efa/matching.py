"""Normalización de nombres y cruce de identidades entre fuentes.

El problema: el `id` de Fantaking no tiene nada que ver con el `person.code` de
la EuroLeague. La única llave común es nombre + equipo, y los nombres vienen en
formatos distintos, con acentos, apellidos compuestos y a veces inicial en vez
de nombre de pila.

Los datos reales mandan sobre cualquier suposición. Al ver el mercado de
verdad por primera vez resultó que Fantaking usa SIEMPRE el formato
`"I. Apellido"` ("S. Vezenkov", "M. James") y el `tvCode` del club ("OLY",
"EFS"). El feed oficial, por su parte, trae el apellido y el nombre separados
en campos propios (`passportSurname`, `passportName`), no solo el
`"APELLIDO, NOMBRE"` de la cadena.

Así que la llave buena no es la similitud de cadenas: es el par
(apellido, inicial del nombre), que ambas fuentes pueden producir de forma
exacta. La similitud difusa queda de último recurso.

La estrategia es en cascada, de más fiable a menos:

  1. `overrides`     — decisión manual, gana siempre.
  2. `initial-club`  — apellido + inicial, dentro del mismo club.
  3. `surname-club`  — apellido único dentro del club, sin inicial que lo contradiga.
  4. `exact`/`subset`/`fuzzy-club` — nombres compuestos y con partícula, mismo club.
  5. `initial-open`  — apellido + inicial, único en toda la liga.
  6. `prior-season`  — igual, contra el censo de la temporada anterior.

El paso 6 no es un capricho: en pretemporada el censo oficial está a medias
(hubo un momento en que el Barça tenía 7 jugadores inscritos), y sin él el
cruce se desploma justo cuando más falta hace. El club siempre se toma de
Fantaking, que sí está al día, así que emparejar contra el censo viejo no
arrastra el equipo antiguo.

Todo lo que no llega a los umbrales se escribe en un informe de no emparejados
para revisión manual, en vez de inventarse un match.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from rapidfuzz import fuzz

# Sufijos que no aportan identidad y aparecen de forma inconsistente.
_NAME_NOISE = {"JR", "JR.", "SR", "SR.", "II", "III", "IV"}
_PUNCT = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPACES = re.compile(r"\s+")

FUZZY_CLUB_THRESHOLD = 86
FUZZY_OPEN_THRESHOLD = 93


def strip_accents(text: str) -> str:
    """Quita tildes y diacríticos: 'Nikola Mirotić' -> 'Nikola Mirotic'."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_name(raw: str) -> str:
    """Forma canónica: sin acentos, mayúsculas, sin puntuación ni ruido."""
    if not raw:
        return ""
    text = strip_accents(str(raw)).upper()
    # "JONES, DAMIAN" y "DAMIAN JONES" deben acabar igual: la coma solo separa.
    text = text.replace(",", " ")
    text = _PUNCT.sub(" ", text)
    tokens = [t for t in _SPACES.split(text) if t and t not in _NAME_NOISE]
    return " ".join(tokens)


def name_tokens(raw: str) -> frozenset[str]:
    """Conjunto de tokens significativos (ignora iniciales sueltas)."""
    return frozenset(t for t in normalize_name(raw).split() if len(t) > 1)


def name_signature(raw: str) -> tuple[frozenset[str], frozenset[str]]:
    """(tokens largos, iniciales) — permite casar 'D. Jones' con 'Jones, Damian'."""
    tokens = normalize_name(raw).split()
    longs = frozenset(t for t in tokens if len(t) > 1)
    initials = frozenset(t[0] for t in tokens)
    return longs, initials


def split_market_name(raw: str) -> tuple[frozenset[str], frozenset[str]]:
    """Descompone el nombre tal y como lo escribe Fantaking: `"I. Apellido"`.

    Devuelve (tokens del apellido, iniciales del nombre). Las iniciales son los
    tokens de una sola letra; el resto es apellido. Funciona igual si algún día
    escriben el nombre completo, porque entonces simplemente no hay iniciales
    sueltas y el apellido se lleva todos los tokens.
    """
    tokens = normalize_name(raw).split()
    initials = frozenset(t for t in tokens if len(t) == 1)
    surname = frozenset(t for t in tokens if len(t) > 1)
    return surname, initials


def split_official_name(
    name: str,
    passport_surname: str | None,
    passport_name: str | None,
    abbreviated_name: str | None = None,
) -> tuple[frozenset[str], frozenset[str]]:
    """Lo mismo para el feed oficial, aprovechando sus campos estructurados.

    `passportSurname` y `passportName` vienen rellenos en el 100% de los
    registros, así que no hace falta adivinar dónde acaba el apellido. La cadena
    `"APELLIDO, NOMBRE"` es el respaldo por si algún día dejan de venir.

    Las iniciales se recogen de TODAS las formas del nombre a la vez, no solo
    del pasaporte. Vezenkov es "SASHA" en el nombre deportivo y "ALEKSANDAR" en
    el pasaporte; quedarse con una sola fuente deja fuera al jugador cuando la
    otra es la que usa Fantaking.
    """
    if passport_surname:
        surname = frozenset(normalize_name(passport_surname).split())
    elif "," in name:
        surname = frozenset(normalize_name(name.split(",")[0]).split())
    else:
        surname = frozenset(t for t in normalize_name(name).split() if len(t) > 1)

    given_tokens: list[str] = []
    if passport_name:
        given_tokens += normalize_name(passport_name).split()
    if "," in name:
        given_tokens += normalize_name(name.split(",", 1)[1]).split()
    if abbreviated_name and "," in abbreviated_name:
        given_tokens += normalize_name(abbreviated_name.split(",", 1)[1]).split()

    # Los tokens del apellido no cuentan como nombre de pila: en
    # "FALL, MOUSTAPHA" con pasaporte "MOUSTAPHA FALOU" no queremos que la F de
    # FALOU se confunda con nada del apellido.
    initials = frozenset(token[0] for token in given_tokens if token and token not in surname)
    return surname, initials


# ---------------------------------------------------------------------------
# Clubes
# ---------------------------------------------------------------------------
# Alias que no se deducen de los campos del feed oficial. Se amplía a mano
# cuando aparezca una forma nueva en los datos de Fantaking.
CLUB_EXTRA_ALIASES: dict[str, tuple[str, ...]] = {
    "IST": ("ANADOLU EFES", "EFES", "EFES ISTANBUL"),
    "MIL": ("OLIMPIA MILANO", "EA7 EMPORIO ARMANI MILAN", "ARMANI MILANO", "MILANO"),
    "BES": ("BESIKTAS", "BESIKTAS FIBABANKA"),
    "RED": ("CRVENA ZVEZDA", "ZVEZDA", "RED STAR", "ESTRELLA ROJA"),
    "DUB": ("DUBAI BC", "DUBAI BASKETBALL"),
    "BAR": ("BARCELONA", "FCB", "BARCA"),
    "MUN": ("BAYERN", "BAYERN MUNICH", "FC BAYERN MUNCHEN"),
    "ULK": ("FENERBAHCE", "FENERBAHCE BEKO", "FENER"),
    "HTA": ("HAPOEL TEL AVIV", "HAPOEL", "HAPOEL IBI TEL AVIV"),
    "BAS": ("BASKONIA", "SASKI BASKONIA", "BASKONIA VITORIA GASTEIZ"),
    "ASV": ("ASVEL", "LDLC ASVEL", "VILLEURBANNE"),
    "TEL": ("MACCABI", "MACCABI TEL AVIV", "MACCABI PLAYTIKA TEL AVIV"),
    "OLY": ("OLYMPIACOS", "OLYMPIAKOS", "OLYMPIACOS PIRAEUS"),
    "PAN": ("PANATHINAIKOS", "PAO", "PANATHINAIKOS AKTOR ATHENS"),
    "PRS": ("PARIS", "PARIS BASKETBALL"),
    "PAR": ("PARTIZAN", "PARTIZAN BELGRADE"),
    "MAD": ("REAL MADRID", "REAL"),
    "PAM": ("VALENCIA", "VALENCIA BASKET", "VALENCIA BC"),
    "VIR": ("VIRTUS", "VIRTUS BOLOGNA", "SEGAFREDO VIRTUS BOLOGNA"),
    "ZAL": ("ZALGIRIS", "ZALGIRIS KAUNAS"),
}


def build_club_alias_map(clubs: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Mapa alias normalizado -> código de club oficial (IST, MAD, ...)."""
    alias_to_code: dict[str, str] = {}

    def register(alias: str, code: str) -> None:
        key = normalize_name(alias)
        if key:
            alias_to_code.setdefault(key, code)

    for club in clubs:
        code = club["code"]
        for field_name in ("code", "tvCode", "name", "abbreviatedName", "editorialName", "clubPermanentName", "clubPermanentAlias"):
            value = club.get(field_name)
            if value:
                register(str(value), code)
        for alias in CLUB_EXTRA_ALIASES.get(code, ()):
            register(alias, code)

    return alias_to_code


def resolve_club(raw: str, alias_map: dict[str, str]) -> str | None:
    """Resuelve el nombre de equipo de Fantaking a un código oficial."""
    if not raw:
        return None
    key = normalize_name(raw)
    if key in alias_map:
        return alias_map[key]

    # Coincidencia por contención: "FC BARCELONA BASQUET" contiene "BARCELONA".
    candidates = [(alias, code) for alias, code in alias_map.items() if alias and (alias in key or key in alias)]
    if candidates:
        alias, code = max(candidates, key=lambda item: len(item[0]))
        return code

    best_code, best_score = None, 0
    for alias, code in alias_map.items():
        score = fuzz.token_sort_ratio(key, alias)
        if score > best_score:
            best_code, best_score = code, score
    return best_code if best_score >= 85 else None


# ---------------------------------------------------------------------------
# Jugadores
# ---------------------------------------------------------------------------
@dataclass
class OfficialPlayer:
    person_code: str
    name: str
    club_code: str
    position: str
    dorsal: str = ""
    height: int | None = None
    birth_date: str | None = None
    country: str | None = None
    image: str | None = None
    tokens: frozenset[str] = field(default_factory=frozenset)
    initials: frozenset[str] = field(default_factory=frozenset)
    normalized: str = ""
    surname: frozenset[str] = field(default_factory=frozenset)
    given_initials: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def from_feed(cls, entry: dict[str, Any]) -> OfficialPlayer:
        person = entry.get("person", {})
        club = entry.get("club") or {}
        name = person.get("name") or ""
        tokens, initials = name_signature(name)
        surname, given_initials = split_official_name(
            name,
            person.get("passportSurname"),
            person.get("passportName"),
            person.get("abbreviatedName"),
        )
        images = person.get("images") or {}
        return cls(
            person_code=str(person.get("code", "")),
            name=name,
            club_code=str(club.get("code", "")),
            position=str(entry.get("positionName") or ""),
            dorsal=str(entry.get("dorsal") or ""),
            height=person.get("height"),
            birth_date=(person.get("birthDate") or "")[:10] or None,
            country=(person.get("country") or {}).get("code"),
            image=images.get("headshot") or images.get("action"),
            tokens=tokens,
            initials=initials,
            normalized=normalize_name(name),
            surname=surname,
            given_initials=given_initials,
        )


@dataclass(frozen=True)
class MatchResult:
    fantaking_id: int
    fantaking_name: str
    fantaking_team: str
    club_code: str | None
    person_code: str | None
    official_name: str | None
    method: str
    confidence: float

    @property
    def matched(self) -> bool:
        return self.person_code is not None


class PlayerMatcher:
    """Empareja jugadores de Fantaking con el censo oficial de la EuroLeague."""

    def __init__(
        self,
        official_players: Iterable[OfficialPlayer],
        club_alias_map: dict[str, str],
        overrides: dict[int, str] | None = None,
        prior_players: Iterable[OfficialPlayer] | None = None,
    ) -> None:
        self.players = list(official_players)
        self.club_alias_map = club_alias_map
        self.overrides = overrides or {}

        # El censo de la temporada anterior solo aporta identidades que aún no
        # están en el actual; nunca pisa a alguien ya presente.
        current_codes = {p.person_code for p in self.players}
        self.prior_players = [
            p for p in (prior_players or []) if p.person_code not in current_codes
        ]

        self._by_person_code = {p.person_code: p for p in self.players}
        self._by_person_code.update({p.person_code: p for p in self.prior_players})
        self._by_club: dict[str, list[OfficialPlayer]] = {}
        for player in self.players:
            self._by_club.setdefault(player.club_code, []).append(player)

    # -- pasos de la cascada ------------------------------------------------
    def _by_surname_initial(
        self,
        surname: frozenset[str],
        initials: frozenset[str],
        pool: list[OfficialPlayer],
        *,
        strict: bool = False,
    ) -> OfficialPlayer | None:
        """Apellido + inicial del nombre: la llave que ambas fuentes producen exacta.

        Dentro de un club basta con que los apellidos compartan un token
        (apellidos compuestos, partículas). Fuera del club —toda la liga o el
        censo del año pasado— eso es demasiado laxo: "N. Boungou-Colo" (París)
        acababa emparejado con "DE COLO, NANDO" porque comparten COLO y la N.
        Con `strict` el apellido tiene que coincidir entero.
        """
        if not surname:
            return None
        hits = [
            p
            for p in pool
            if (p.surname == surname or (not strict and (p.surname & surname)))
            and (not initials or not p.given_initials or (initials & p.given_initials))
        ]
        return hits[0] if len(hits) == 1 else None

    def _by_surname(
        self,
        surname: frozenset[str],
        initials: frozenset[str],
        pool: list[OfficialPlayer],
    ) -> OfficialPlayer | None:
        """Apellido único en el club, siempre que la inicial no lo contradiga.

        Sin esa salvedad el paso empareja a "V. Brown" con "BROWN, ANTHONY" solo
        porque es el único Brown del equipo. Un apellido compartido es
        justamente el caso en el que la inicial decide, no un detalle que se
        pueda ignorar.
        """
        if not surname:
            return None
        hits = [
            p
            for p in pool
            if p.surname == surname
            and not (initials and p.given_initials and not (initials & p.given_initials))
        ]
        return hits[0] if len(hits) == 1 else None

    def _exact(self, tokens: frozenset[str], pool: list[OfficialPlayer]) -> OfficialPlayer | None:
        hits = [p for p in pool if p.tokens == tokens]
        return hits[0] if len(hits) == 1 else None

    @staticmethod
    def _initial_conflicts(initials: frozenset[str], player: OfficialPlayer) -> bool:
        """True si ambas fuentes declaran inicial del nombre y no coinciden.

        Cuando las dos partes dicen algo y dicen cosas distintas, son personas
        distintas. Si una de las dos no aporta inicial, no hay contradicción:
        simplemente no hay información que contrastar.
        """
        return bool(initials and player.given_initials and not (initials & player.given_initials))

    def _subset(
        self,
        tokens: frozenset[str],
        initials: frozenset[str],
        pool: list[OfficialPlayer],
    ) -> OfficialPlayer | None:
        """Un lado puede traer solo el apellido, o un nombre compuesto de más.

        Cubre nombres con partícula o compuestos ("A. M'Baye", "M. Pereira"),
        donde los conjuntos de tokens no coinciden exactamente. Sigue exigiendo
        que la inicial no contradiga.
        """
        if not tokens:
            return None
        hits = [
            p
            for p in pool
            if (tokens <= p.tokens or p.tokens <= tokens)
            and not self._initial_conflicts(initials, p)
        ]
        return hits[0] if len(hits) == 1 else None

    def _fuzzy(self, normalized: str, pool: list[OfficialPlayer], threshold: int) -> tuple[OfficialPlayer | None, float]:
        best, best_score = None, 0.0
        for player in pool:
            score = float(fuzz.token_sort_ratio(normalized, player.normalized))
            if score > best_score:
                best, best_score = player, score
        if best is not None and best_score >= threshold:
            return best, best_score
        return None, best_score

    # -- API ----------------------------------------------------------------
    def match(self, fantaking_id: int, raw_name: str, raw_team: str) -> MatchResult:
        club_code = resolve_club(raw_team, self.club_alias_map)
        tokens, initials = name_signature(raw_name)
        normalized = normalize_name(raw_name)

        def result(player: OfficialPlayer | None, method: str, confidence: float) -> MatchResult:
            return MatchResult(
                fantaking_id=fantaking_id,
                fantaking_name=raw_name,
                fantaking_team=raw_team,
                club_code=club_code,
                person_code=player.person_code if player else None,
                official_name=player.name if player else None,
                method=method,
                confidence=confidence,
            )

        # 1. Override manual.
        override_code = self.overrides.get(fantaking_id)
        if override_code:
            return result(self._by_person_code.get(override_code), "override", 100.0)

        pool = self._by_club.get(club_code or "", [])
        surname, given_initials = split_market_name(raw_name)

        # 2-4. Dentro del club, de la llave más fiable a la más laxa.
        if pool:
            if (hit := self._by_surname_initial(surname, given_initials, pool)) is not None:
                return result(hit, "initial-club", 99.0)
            if (hit := self._by_surname(surname, given_initials, pool)) is not None:
                return result(hit, "surname-club", 96.0)
            if (hit := self._exact(tokens, pool)) is not None:
                return result(hit, "exact", 100.0)
            if (hit := self._subset(tokens, given_initials, pool)) is not None:
                return result(hit, "subset", 95.0)
            hit, score = self._fuzzy(normalized, pool, FUZZY_CLUB_THRESHOLD)
            if hit is not None:
                return result(hit, "fuzzy-club", score)

        # 5. Sin restringir club: cubre fichajes que el censo aún no refleja.
        if (
            hit := self._by_surname_initial(surname, given_initials, self.players, strict=True)
        ) is not None:
            return result(hit, "initial-open", 93.0)
        if (hit := self._exact(tokens, self.players)) is not None:
            return result(hit, "exact-open", 92.0)

        # 6. Censo de la temporada anterior, para cuando el actual va a medias.
        if self.prior_players:
            if (
                hit := self._by_surname_initial(
                    surname, given_initials, self.prior_players, strict=True
                )
            ) is not None:
                return result(hit, "prior-season", 90.0)

        hit, score = self._fuzzy(normalized, self.players, FUZZY_OPEN_THRESHOLD)
        if hit is not None:
            return result(hit, "fuzzy-open", score)

        return result(None, "unmatched", score)

    def match_all(self, rows: Iterable[tuple[int, str, str]]) -> list[MatchResult]:
        return [self.match(pid, name, team) for pid, name, team in rows]
