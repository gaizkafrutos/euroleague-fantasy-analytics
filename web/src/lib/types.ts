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
  price: number | null;
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
}

/** Series largas, en su propio fichero para no engordar el listado. */
export interface PlayerDetail {
  priceHistory: PricePoint[];
  recent: GameLine[];
  fixtures: Fixture[];
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
}

export interface LineupPlayer {
  key: string;
  name: string;
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
