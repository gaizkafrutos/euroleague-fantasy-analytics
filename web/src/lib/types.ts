/** Tipos del contrato de datos entre el pipeline Python y la web.
 *  Si cambias `efa/build.py`, cambia esto. */

export type Position = "G" | "F" | "C";

export interface PricePoint {
  t: string;
  q: number;
}

export interface Fixture {
  round: number;
  opponent: string;
  home: boolean;
  date: string | null;
  opponent_rating: number;
}

export interface GameLine {
  round: number | null;
  opponent: string | null;
  home: boolean;
  minutes: number;
  fp: number;
  played: boolean;
}

export interface Performance {
  games: number | null;
  gamesPlayed: number | null;
  minutesAvg: number | null;
  minutesRecent: number | null;
  minutesTrend: number | null;
  minutesShareRecent: number | null;
  minutesShareTrend: number | null;
  fpAvg: number | null;
  fpMedian: number | null;
  fpStd: number | null;
  fpFloor: number | null;
  fpCeiling: number | null;
  fpPerMin: number | null;
  consistency: number | null;
  /** La fiabilidad sale de la dispersión encogida (menos de 3 partidos), no de la suya. */
  consistencyEstimated?: boolean;
  form: number | null;
  formDelta: number | null;
  lastFp: number | null;
  startedRate: number | null;
  dnpRate: number | null;
  /** Medias de caja. Opcionales: un players.json anterior al parche no las trae. */
  ptsAvg?: number | null;
  rebAvg?: number | null;
  astAvg?: number | null;
  pirAvg?: number | null;
  plusMinusAvg?: number | null;
  /** Minutos por partido de la temporada anterior. */
  minutesPrior?: number | null;
}

export interface MarketStats {
  fpt?: number | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  steals?: number | null;
  turnovers?: number | null;
  blocksFavour?: number | null;
  blocksAgainst?: number | null;
  foulsDrawn?: number | null;
  foulsCommitted?: number | null;
  missedFg?: number | null;
  missedFt?: number | null;
  priceChangeReported?: number | null;
}

/** Disponibilidad para la próxima jornada: parte de BasketNews + censo oficial.
 *  `out` no juega (el optimizador no lo ficha), `doubt` en el aire,
 *  `probable` se espera que juegue. Null = sin noticias. */
export type AvailabilityLevel = "out" | "doubt" | "probable";

export interface Availability {
  level: AvailabilityLevel;
  /** injury = lesión · coach = decisión técnica · roster = fuera de la
   *  convocatoria o sin inscribir · manual = corrección a mano. */
  kind: "injury" | "coach" | "roster" | "manual";
  /** Frase corta ya en castellano: "Baja hasta la J4". */
  label: string;
  untilRound: number | null;
  /** Comentario original del parte, en inglés. */
  detail: string;
  /** Estado y jornada tal y como los da la fuente: "Out · Round 2-4". */
  reported: string;
  source: string;
}

export interface Player {
  id: number;
  personCode: string | null;
  /** Null en los que no cruzan con el censo oficial: ahí solo hay
   *  `marketName`. Era `string` y mentía, y la ficha reventaba al construir. */
  name: string | null;
  marketName: string | null;
  club: string | null;
  clubName: string | null;
  clubShort: string | null;
  clubCrest: string | null;
  position: Position | null;
  positionLabel: string | null;
  isCoach: boolean;
  dorsal: string | null;
  image: string | null;
  height: number | null;
  country: string | null;
  birthDate: string | null;
  /** Lo que se paga: el precio pendiente si el juego aún no ha aplicado la
   *  revalorización de la jornada (ver `lib/data.ts`), si no el del juego. */
  price: number | null;
  /** Precio que enseña ahora mismo el juego, solo si difiere del pendiente. */
  priceGame?: number | null;
  /** Cotización estimada al cerrar la jornada, con precios desfasados. */
  pricePending?: number | null;
  pricePendingSource?: "juego" | "modelo";
  priceOpen: number | null;
  priceDeltaLast: number | null;
  priceDeltaTotal: number | null;
  priceSnapshots: number | null;
  market: MarketStats;
  perf: Performance;
  projectedFp: number | null;
  valuePerCredit: number | null;
  valueProjected: number | null;
  valueMarket: number | null;
  pricePressure: number | null;
  bargainScore: number | null;
  schedule: { difficulty: number | null };
  match: { method: string | null; confidence: number | null };
  /** Qué pasa con su precio si rinde lo proyectado. Null en entrenadores sin
   *  precio o en quien no tiene proyección. */
  outlook?: Outlook | null;
  /** Opcionales: un players.json anterior al parte de lesiones no los trae. */
  availability?: Availability | null;
  /** False si está en el mercado pero no inscrito en la Euroliga. */
  registered?: boolean;
}

export interface Outlook {
  /** Puntos fantasy con los que su precio no se mueve. */
  breakEven: number;
  /** Variación de precio esperada (créditos) si puntúa lo proyectado. */
  expectedChange: number;
  /** Probabilidad de superar el umbral, con una normal (proyección, sd). */
  riseProb: number;
  sd: number;
  /** Percentiles 25 y 75 de su puntuación esperada. */
  floor: number;
  ceiling: number;
}

/** [intentos, anotados] por zona, en el orden de `meta.league.zoneKeys`. */
export type ZoneCounts = Array<[number, number]>;

export interface ShotDetail {
  seasons: string[];
  zones: ZoneCounts;
  current: ZoneCounts;
  /** Tiros de esta temporada: [x, y, anotado, valor], en cm respecto al aro. */
  dots: Array<[number, number, number, number]>;
  profile: {
    attempts: number;
    pointsPerShot: number;
    threeRate: number;
    rimRate: number;
    fastbreak: number;
    secondChance: number;
  };
}

export interface OnOff {
  onNet: number | null;
  offNet: number | null;
  onOrtg: number | null;
  onDrtg: number | null;
  offOrtg: number | null;
  offDrtg: number | null;
  diff: number | null;
  onPoss: number;
  offPoss: number;
}

export interface CourtDetail {
  seasons: string[];
  games: number;
  minutes: number;
  /** Q1, Q2, Q3, Q4 y prórrogas, por partido. */
  periodMinutes: number[];
  clutchMinutes: number;
  clutchGames: number;
  usage: number | null;
  onOff: OnOff;
}

export type MixKey =
  | "points"
  | "rebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "foulsDrawn"
  | "winBonus"
  | "missedFg"
  | "missedFt"
  | "turnovers"
  | "foulsCommitted"
  | "blocksAgainst";

export interface MixDetail {
  season: string;
  games: number;
  /** Media por partido, ya con signo: las acciones que restan van en negativo. */
  parts: Record<MixKey, number>;
}

export interface OfficialMetric {
  key: string;
  label: string;
  value: number;
  format: "pct";
  percentile: number | null;
  higherIsBetter: boolean;
}

export interface OfficialDetail {
  season: string;
  games: number;
  minutes: number;
  doubleDoubles: number;
  starts: number;
  position: string | null;
  poolSize: number;
  metrics: OfficialMetric[];
}

/** Series largas, en su propio fichero para no engordar el listado. */
export interface PlayerDetail {
  priceHistory: PricePoint[];
  recent: GameLine[];
  fixtures: Fixture[];
  shots?: ShotDetail;
  court?: CourtDetail;
  mix?: MixDetail;
  official?: OfficialDetail;
}

export type DetailsIndex = Record<string, PlayerDetail>;

/** Índices reconstruidos desde los boxscores. `null` cuando el club no tiene
 *  histórico — un recién llegado no es un equipo con ceros. */
export interface TeamBox {
  games: number | null;
  wins: number | null;
  losses: number | null;
  ppg: number | null;
  papg: number | null;
  offRating: number | null;
  defRating: number | null;
  netRating: number | null;
  pace: number | null;
  efg: number | null;
  tovRate: number | null;
  orbRate: number | null;
  ftRate: number | null;
  astPerGame: number | null;
  threeRate: number | null;
}

/** Colores derivados del escudo, fijados en data/overrides/club_colors.csv.
 *  `halo` pinta el fondo del retrato; `stat*` los aros de estadística. */
export interface ClubColors {
  halo: string | null;
  statDark: string | null;
  statLight: string | null;
}

export interface Team {
  code: string;
  name: string | null;
  short: string | null;
  country: string | null;
  crest: string | null;
  offense: number | null;
  defense: number | null;
  netRating: number | null;
  winRate: number | null;
  games: number | null;
  ratingSource: string | null;
  difficulty: number | null;
  fixtures: Fixture[];
  box?: TeamBox | null;
  colors?: ClubColors | null;
  allowed?: Allowed | null;
  upcoming?: Upcoming[];
  quarters?: {
    current: QuarterSplit | null;
    prior: QuarterSplit | null;
    currentSeason: string;
    priorSeason: string;
  };
  lineups?: TeamLineup[];
}

/** Puntos fantasy por partido que sacan contra él los rivales de cada puesto,
 *  encogidos hacia el año pasado. `index`: 1,10 = un 10 % más que la media. */
export interface Allowed {
  games: number;
  G: number | null;
  F: number | null;
  C: number | null;
  all: number | null;
  index: { G: number | null; F: number | null; C: number | null; all: number | null };
}

export interface Upcoming {
  round: number;
  opponent: string;
  home: boolean;
  date: string | null;
}

export interface QuarterSplit {
  games: number;
  for: number[];
  against: number[];
  overtimes: number;
}

export interface TeamLineup {
  players: string[];
  names: string[];
  ids: Array<number | null>;
  minutes: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  possessions: number;
  net: number | null;
}

export interface LineupPlayer {
  key: string;
  /** Null en los entrenadores: no cruzan con el censo oficial. */
  name: string | null;
  position: Position;
  club: string;
  price: number;
  projection: number;
}

export interface Lineup {
  available: boolean;
  reason?: string;
  method?: string;
  budget?: number;
  totalPrice?: number;
  /** Suma llana de los diez. NO es lo que se puntúa. */
  totalProjection?: number;
  /** Lo que de verdad puntuaría: capitán ×2, banquillo ×0,5, entrenador. */
  scoredProjection?: number;
  captain?: string | null;
  /** Claves de los cinco del quinteto; el capitán sale de aquí. */
  starters?: string[];
  /** El sexto hombre, que también puntúa al 100 %. */
  sixth?: string | null;
  /** Los cuatro que puntúan a la mitad. */
  bench?: string[];
  coach?: LineupPlayer | null;
  players?: LineupPlayer[];
}

export interface Meta {
  season: string;
  seasonLabel: string;
  generatedAt: string;
  currentRound: number;
  totalRounds: number;
  hasPrices: boolean;
  priceSnapshots: number;
  lastPriceCapture: string | null;
  performanceSource: { source: string | null; isBaseline: boolean; games: number };
  teamStrengthSource: string | null;
  players: number;
  matched: number;
  matchRate: number;
  budget: number;
  coachGames: number;
  warnings: string[];
  priceFreshness?: PriceFreshness;
  injuries?: InjuriesMeta;
  priceModel?: PriceModel;
  league?: LeagueRef;
}

/** ¿El último snapshot lleva ya la revalorización de la última jornada? */
export interface PriceFreshness {
  stale: boolean;
  capturedAt: string | null;
  lastGameAt: string | null;
  round: number | null;
  reason: string | null;
  /** Jugadores con precio pendiente distinto del del juego. */
  pending: number;
}

/** plus = a·puntos + b·precio + c, ajustado sobre el último snapshot. */
export interface PriceModel {
  a: number;
  b: number;
  c: number;
  r2: number;
  n: number;
  source: string;
}

export interface LeagueRef {
  zones: ZoneCounts;
  zoneKeys: string[];
  zoneLabels: string[];
  allowed: { G: number; F: number; C: number; all: number };
  shotSeasons: string[];
  seasonLabels: Record<string, string>;
}

export interface InjuriesMeta {
  source: string | null;
  url?: string | null;
  /** Hora de la última actualización del parte, según la propia fuente. */
  updatedAt?: string | null;
  fetchedAt?: string | null;
  rows: number;
  matched: number;
  unmatched: string[];
  nextRound?: number;
  unregistered?: number;
  flagged?: { out: number; doubt: number; probable: number };
}

export interface MatchRow {
  fantaking_id: number;
  fantaking_name: string;
  fantaking_team: string;
  club_code: string | null;
  person_code: string | null;
  official_name: string | null;
  match_method: string;
  match_confidence: number;
}
