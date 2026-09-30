/** Reglas del juego y análisis de plantilla, en cliente.
 *
 *  Duplica a propósito parte de la lógica del optimizador Python: aquí el
 *  objetivo es que mover un deslizador de presupuesto responda al instante,
 *  no calcular el óptimo demostrable. El pipeline manda; esto acompaña.
 *
 *  El baremo es el del reglamento oficial (Classic Mode): diez jugadores y un
 *  entrenador. Quinteto, sexto hombre y entrenador puntúan al 100 %; los cuatro
 *  del banquillo, al 50 %; el capitán sale del quinteto y dobla. Antes este
 *  módulo validaba diez plazas y sumaba los diez al 100 %, que no es el juego
 *  que se juega.
 */
import type { Player } from "./types";

export const QUOTA = { G: 4, F: 4, C: 2 } as const;
/** Jugadores. El entrenador va aparte: no tiene puesto ni cuenta en las cuotas. */
export const SQUAD_SIZE = QUOTA.G + QUOTA.F + QUOTA.C;
/** Plazas totales: los diez más el entrenador. */
export const ROSTER_SIZE = SQUAD_SIZE + 1;
export const STARTERS = 5;
/** Quinteto + sexto hombre: los que puntúan enteros. */
export const FULL_SCORERS = STARTERS + 1;
export const MAX_PER_CLUB = 6;
/** Formaciones del quinteto que admite el reglamento (bases-aleros-pívots):
 *  2-2-1, 1-2-2, 2-1-2, 1-3-1 y 3-1-1. Con 4-4-2 en plantilla son justo las
 *  que tienen al menos uno de cada puesto, que es como se aplica. */
export const ALLOWED_FORMATIONS = ["2-2-1", "1-2-2", "2-1-2", "1-3-1", "3-1-1"] as const;
export const DEFAULT_BUDGET = 100;
/** Holgura para comparar sumas de precios con un decimal: 99,99999 cabe en 100. */
export const BUDGET_EPS = 1e-6;

/* ---------------------------------------------------------- disponibilidad */

/** De baja para la próxima jornada según el parte (o una corrección manual). */
export function isOut(player: Player): boolean {
  return player.availability?.level === "out";
}

/** Fichable esta jornada: ni de baja ni sin inscribir en la Euroliga. */
export function isSignable(player: Player): boolean {
  return !isOut(player) && player.registered !== false;
}

/** Lo que de verdad va a puntuar: un jugador de baja proyecta 0 aunque su
 *  media sea 20. Todo el cálculo de la consola (roles, puntuación, fichajes)
 *  pasa por aquí, así que tener a un lesionado en el quinteto se nota en la
 *  cifra en vez de esconderse. */
export function effectiveProjection(player: Player | null | undefined): number {
  if (!player) return 0;
  return isOut(player) ? 0 : (player.projectedFp ?? 0);
}

/* ------------------------------------------------------------------ roles */

export interface Roles {
  /** Hasta cinco, de mayor a menor proyección. El primero es el capitán. */
  starters: Player[];
  sixth: Player | null;
  /** Los que puntúan a la mitad. */
  bench: Player[];
  captain: Player | null;
}

/** El mejor reparto posible para una plantilla dada.
 *
 *  Quinteto y sexto hombre puntúan igual (100 %), así que lo que importa es
 *  QUÉ seis puntúan enteros. La única regla que los condiciona es la
 *  formación: en el quinteto tiene que haber al menos uno de cada puesto.
 *
 *  1. Si entre los seis mejores falta algún puesto, el mejor de ese puesto
 *     entra obligado.
 *  2. El resto de huecos, para los de mayor proyección.
 *  3. El sexto es el peor de esos seis cuya salida no deje al quinteto sin un
 *     puesto; el capitán, el mejor, que siempre queda en el quinteto.
 *
 *  Es el mismo algoritmo que `assign_roles()` en optimizer.py, y allí un test
 *  lo compara con una búsqueda exhaustiva sobre 300 plantillas aleatorias.
 */
export function assignRoles(players: Player[]): Roles {
  const ranked = [...players].sort((a, b) => effectiveProjection(b) - effectiveProjection(a));
  const positions = ["G", "F", "C"] as const;
  const needed = positions.filter((p) => ranked.some((player) => player.position === p));
  const top = ranked.slice(0, FULL_SCORERS);

  const mandatory = needed
    .filter((p) => !top.some((player) => player.position === p))
    .map((p) => ranked.find((player) => player.position === p))
    .filter((player): player is Player => Boolean(player));
  const rest = ranked.filter((player) => !mandatory.includes(player));
  const full = [...mandatory, ...rest.slice(0, Math.max(FULL_SCORERS - mandatory.length, 0))].sort(
    (a, b) => effectiveProjection(b) - effectiveProjection(a),
  );

  let sixth: Player | null = null;
  if (full.length > STARTERS) {
    for (const candidate of [...full.slice(1)].reverse()) {
      const remaining = full.filter((player) => player !== candidate);
      if (needed.every((p) => remaining.some((player) => player.position === p))) {
        sixth = candidate;
        break;
      }
    }
  }

  const starters = full.filter((player) => player !== sixth);
  return {
    starters,
    sixth,
    bench: ranked.filter((player) => !full.includes(player)),
    captain: starters[0] ?? null,
  };
}

/* ------------------------------------------------------- alineación a mano */

/** La alineación que elige el usuario (ids). Los cuatro que no están en el
 *  quinteto ni de sexto van al banquillo. */
export interface ManualLineup {
  starters: number[];
  sixth: number | null;
  captain: number | null;
}

/** El quinteto que admite el reglamento: cinco, con al menos un base, un alero
 *  y un pívot (con 4-4-2 en plantilla, eso son justo 2-2-1, 1-2-2, 2-1-2,
 *  1-3-1 y 3-1-1). */
export function isValidQuintet(starters: Player[]): boolean {
  if (starters.length !== STARTERS) return false;
  return (["G", "F", "C"] as const).every((p) => starters.some((player) => player.position === p));
}

/** Los roles de una alineación elegida a mano, o null si ya no cuadra con la
 *  plantilla (alguien ha salido) o el quinteto no es reglamentario. Un capitán
 *  fuera del quinteto pasa al que más proyecta del quinteto. */
export function manualRoles(players: Player[], manual: ManualLineup | null): Roles | null {
  if (!manual || players.length !== SQUAD_SIZE) return null;
  const byId = new Map(players.map((player) => [player.id, player]));
  const starters = manual.starters.map((id) => byId.get(id));
  if (starters.some((player) => !player) || new Set(manual.starters).size !== STARTERS) return null;
  const quintet = starters as Player[];
  if (!isValidQuintet(quintet)) return null;
  const sixth = manual.sixth !== null ? (byId.get(manual.sixth) ?? null) : null;
  if (!sixth || manual.starters.includes(sixth.id)) return null;
  const bench = players
    .filter((player) => !manual.starters.includes(player.id) && player.id !== sixth.id)
    .sort((a, b) => effectiveProjection(b) - effectiveProjection(a));
  const captain =
    quintet.find((player) => player.id === manual.captain) ??
    [...quintet].sort((a, b) => effectiveProjection(b) - effectiveProjection(a))[0] ??
    null;
  return { starters: quintet, sixth, bench, captain };
}

/** Los roles como alineación editable (para partir de la automática). */
export function toManual(roles: Roles): ManualLineup {
  return {
    starters: roles.starters.map((player) => player.id),
    sixth: roles.sixth?.id ?? null,
    captain: roles.captain?.id ?? null,
  };
}

/** Intercambia de sitio a dos jugadores (quinteto, sexto o banquillo). Devuelve
 *  la alineación nueva o un motivo si el quinteto dejaría de ser válido. */
export function swapInLineup(
  players: Player[],
  manual: ManualLineup,
  a: number,
  b: number,
): { lineup: ManualLineup } | { error: string } {
  const place = (id: number) =>
    manual.starters.includes(id) ? "starter" : manual.sixth === id ? "sixth" : "bench";
  const pa = place(a);
  const pb = place(b);
  if (pa === pb && pa !== "starter") return { lineup: manual };
  if (pa === "starter" && pb === "starter") return { lineup: manual };
  // Cada uno ocupa el sitio del otro: el quinteto cambia a quien estuviera en
  // él, y el sexto pasa a ser el que llega.
  const starters = manual.starters.map((id) => (id === a ? b : id === b ? a : id));
  const sixth = pa === "sixth" ? b : pb === "sixth" ? a : manual.sixth;
  const byId = new Map(players.map((player) => [player.id, player]));
  const quintet = starters.map((id) => byId.get(id)).filter((p): p is Player => Boolean(p));
  if (!isValidQuintet(quintet)) {
    return {
      error: `El quinteto quedaría ${formationOf(quintet)}: el reglamento pide al menos un base, un alero y un pívot en pista.`,
    };
  }
  const captain = starters.includes(manual.captain ?? -1) ? manual.captain : null;
  return { lineup: { starters, sixth, captain } };
}

/** "3-1-1": bases, aleros y pívots del quinteto. */
export function formationOf(starters: Player[]): string {
  return (["G", "F", "C"] as const)
    .map((p) => starters.filter((player) => player.position === p).length)
    .join("-");
}

/** Lo que puntúa la plantilla con el baremo real, entrenador incluido. */
export function scoredProjection(roles: Roles, coach: Player | null): number {
  const p = effectiveProjection;
  const full = roles.starters.reduce((sum, player) => sum + p(player), 0) + p(roles.sixth);
  const half = roles.bench.reduce((sum, player) => sum + p(player), 0) * 0.5;
  // El capitán ya está sumado una vez dentro del quinteto: se añade otra.
  return full + half + p(roles.captain) + p(coach);
}

/** Lo que multiplica sus puntos el sitio que ocupa: capitán 2, quinteto y
 *  sexto 1, banquillo 0,5. */
export function roleMultiplier(roles: Roles, player: Player): number {
  if (roles.captain?.id === player.id) return 2;
  if (roles.bench.some((member) => member.id === player.id)) return 0.5;
  return 1;
}

/** Puntos que aporta por crédito en el sitio que ocupa. Un base de 15 puntos
 *  y 15 créditos rinde 1 en el quinteto y 0,5 en el banquillo: lo que le paga
 *  la plantilla no es su valor de mercado, es su valor en su sitio. */
export function rentInRole(roles: Roles, player: Player): number {
  const price = player.price ?? 0;
  if (price <= 0) return 0;
  return (roleMultiplier(roles, player) * effectiveProjection(player)) / price;
}

/* ------------------------------------------------------------- validación */

export interface SquadCheck {
  valid: boolean;
  /** Diez jugadores y un entrenador, sin mirar si cumple las reglas. */
  complete: boolean;
  spent: number;
  free: number;
  problems: string[];
  counts: Record<string, number>;
  clubCounts: Record<string, number>;
  /** Suma llana de los jugadores al 100 %. No es lo que se puntúa. */
  projection: number;
  /** Con el baremo real: capitán ×2, banquillo ×0,5, entrenador al 100 %. */
  scored: number;
  roles: Roles;
  /** Jugadores de la plantilla con aviso de disponibilidad, de baja primero.
   *  No invalidan la plantilla (el juego te deja tenerlos), pero se dicen. */
  alerts: Player[];
}

export function checkSquad(
  squad: Player[],
  budget = DEFAULT_BUDGET,
  coach: Player | null = null,
): SquadCheck {
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  const clubCounts: Record<string, number> = {};
  let spent = coach?.price ?? 0;
  let projection = 0;

  for (const player of squad) {
    if (player.position) counts[player.position] = (counts[player.position] ?? 0) + 1;
    if (player.club) clubCounts[player.club] = (clubCounts[player.club] ?? 0) + 1;
    spent += player.price ?? 0;
    projection += effectiveProjection(player);
  }
  // El entrenador NO cuenta para el máximo de seis por club: el reglamento
  // habla de jugadores, y el optimizador del pipeline tampoco lo cuenta. Si el
  // juego resultara contarlo, hay que cambiarlo aquí y en optimizer.py a la vez.

  const problems: string[] = [];
  for (const [position, quota] of Object.entries(QUOTA)) {
    const have = counts[position] ?? 0;
    if (have > quota) problems.push(`Sobran ${have - quota} en ${positionWord(position)}.`);
    if (have < quota && squad.length >= SQUAD_SIZE)
      problems.push(`Faltan ${quota - have} en ${positionWord(position)}.`);
  }
  if (!coach && squad.length >= SQUAD_SIZE)
    problems.push("Falta el entrenador: es obligatorio y puntúa al 100 %.");
  for (const [club, count] of Object.entries(clubCounts)) {
    if (count > MAX_PER_CLUB)
      problems.push(`${count} de ${club} en la plantilla: el máximo es ${MAX_PER_CLUB}.`);
  }
  if (spent > budget + BUDGET_EPS)
    problems.push(`Te pasas ${(spent - budget).toFixed(1)} créditos del presupuesto.`);

  const roles = assignRoles(squad);
  const complete = squad.length === SQUAD_SIZE && coach !== null;
  const severity = { out: 0, doubt: 1, probable: 2 } as const;
  const alerts = squad
    .filter((player) => player.availability && player.availability.level !== "probable")
    .sort(
      (a, b) =>
        severity[a.availability?.level ?? "probable"] - severity[b.availability?.level ?? "probable"],
    );

  return {
    valid: problems.length === 0 && complete,
    complete,
    spent: Number(spent.toFixed(2)),
    free: Number((budget - spent).toFixed(2)),
    problems,
    counts,
    clubCounts,
    projection: Number(projection.toFixed(2)),
    scored: Number(scoredProjection(roles, coach).toFixed(2)),
    roles,
    alerts,
  };
}

/* ---------------------------------------------------------------- fichajes */

export interface Swap {
  out: Player;
  in: Player;
  /** Ganancia con el baremo real, no en proyección bruta: fichar a un
   *  jugador que acaba en el banquillo solo suma la mitad. */
  gain: number;
  costDelta: number;
  /** El que entra está en duda: el fichaje puede no puntuar. */
  risky: boolean;
}

/** Para cada jugador de la plantilla, el recambio asequible de su puesto que
 *  más sube la puntuación real, recolocando roles después del cambio. */
export function suggestSwaps(
  squad: Player[],
  market: Player[],
  budget = DEFAULT_BUDGET,
  coach: Player | null = null,
  limit = 5,
  coaches: Player[] = [],
): Swap[] {
  const owned = new Set(squad.map((player) => player.id));
  const check = checkSquad(squad, budget, coach);
  const base = check.scored;

  const suggestions: Swap[] = [];
  for (const player of squad) {
    const ceiling = (player.price ?? 0) + check.free;
    let best: Player | null = null;
    let bestGain = 0;

    for (const candidate of market) {
      if (owned.has(candidate.id)) continue;
      if (candidate.position !== player.position) continue;
      if ((candidate.price ?? Infinity) > ceiling + BUDGET_EPS) continue;
      // Nunca se recomienda fichar a alguien de baja o sin inscribir.
      if (!isSignable(candidate)) continue;
      // Poda barata: si no proyecta más, no puede subir la puntuación. Un
      // jugador propio de baja proyecta 0, así que cualquier sano lo mejora.
      if (effectiveProjection(candidate) <= effectiveProjection(player)) continue;

      const clubCount =
        (check.clubCounts[candidate.club ?? ""] ?? 0) - (candidate.club === player.club ? 1 : 0);
      if (clubCount >= MAX_PER_CLUB) continue;

      const next = squad.map((member) => (member.id === player.id ? candidate : member));
      const gain = scoredProjection(assignRoles(next), coach) - base;
      if (gain > bestGain) {
        best = candidate;
        bestGain = gain;
      }
    }

    if (best) {
      suggestions.push({
        out: player,
        in: best,
        gain: Number(bestGain.toFixed(2)),
        costDelta: Number(((best.price ?? 0) - (player.price ?? 0)).toFixed(2)),
        risky: best.availability?.level === "doubt",
      });
    }
  }

  // El entrenador también se cambia (y cuenta como uno de los cambios).
  if (coach && coaches.length) {
    const ceiling = (coach.price ?? 0) + check.free;
    const best = coaches
      .filter(
        (candidate) =>
          candidate.id !== coach.id &&
          (candidate.price ?? Infinity) <= ceiling + BUDGET_EPS &&
          effectiveProjection(candidate) > effectiveProjection(coach),
      )
      .sort((a, b) => effectiveProjection(b) - effectiveProjection(a))[0];
    if (best) {
      suggestions.push({
        out: coach,
        in: best,
        gain: Number((effectiveProjection(best) - effectiveProjection(coach)).toFixed(2)),
        costDelta: Number(((best.price ?? 0) - (coach.price ?? 0)).toFixed(2)),
        risky: false,
      });
    }
  }

  // Un mismo fichaje puede ser el mejor recambio de varios puestos. Se deja
  // solo la versión que más gana: cinco tarjetas con el mismo nombre en
  // "Entra" no son cinco ideas, son una.
  const seen = new Set<number>();
  return suggestions
    .sort((a, b) => b.gain - a.gain)
    .filter((swap) => (seen.has(swap.in.id) ? false : (seen.add(swap.in.id), true)))
    .slice(0, limit);
}

/* ------------------------------------------------------ relleno automático */

export interface BuiltSquad {
  players: Player[];
  coach: Player | null;
}

/** Voraz con reserva de presupuesto: la misma idea que el fallback del pipeline.
 *
 *  Se aparta primero lo que cuesta el entrenador más barato, se llenan los
 *  diez puestos y con lo que sobra se elige el mejor entrenador que quepa.
 *  Solo se usa cuando el presupuesto no es el de 100: para 100 créditos la
 *  consola carga el óptimo exacto que resolvió el pipeline.
 */
export function buildSquad(
  market: Player[],
  budget = DEFAULT_BUDGET,
  coaches: Player[] = [],
): BuiltSquad {
  const coachPool = coaches.filter((coach) => (coach.price ?? 0) > 0);
  const coachFloor = coachPool.length ? Math.min(...coachPool.map((coach) => coach.price ?? 0)) : 0;
  const playerBudget = budget - coachFloor;

  const pool = market
    .filter(
      (player) =>
        player.position && (player.price ?? 0) > 0 && player.projectedFp != null && isSignable(player),
    )
    .sort((a, b) => (b.projectedFp ?? 0) / (b.price ?? 1) - (a.projectedFp ?? 0) / (a.price ?? 1));

  const cheapest: Record<string, number[]> = { G: [], F: [], C: [] };
  for (const position of Object.keys(QUOTA)) {
    cheapest[position] = pool
      .filter((player) => player.position === position)
      .map((player) => player.price ?? 0)
      .sort((a, b) => a - b);
  }

  const players: Player[] = [];
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  const clubCounts: Record<string, number> = {};
  let spent = 0;

  const reserveAfter = (skip: string): number => {
    let total = 0;
    for (const [position, quota] of Object.entries(QUOTA)) {
      let missing = quota - (counts[position] ?? 0);
      if (position === skip) missing -= 1;
      if (missing <= 0) continue;
      total += (cheapest[position] ?? []).slice(0, missing).reduce((sum, price) => sum + price, 0);
    }
    return total;
  };

  for (const player of pool) {
    const position = player.position as keyof typeof QUOTA;
    if (players.length >= SQUAD_SIZE) break;
    if ((counts[position] ?? 0) >= QUOTA[position]) continue;
    if ((clubCounts[player.club ?? ""] ?? 0) >= MAX_PER_CLUB) continue;
    const price = player.price ?? 0;
    if (spent + price + reserveAfter(position) > playerBudget) continue;

    players.push(player);
    counts[position] = (counts[position] ?? 0) + 1;
    clubCounts[player.club ?? ""] = (clubCounts[player.club ?? ""] ?? 0) + 1;
    spent += price;
  }

  const left = budget - spent;
  const coach =
    coachPool
      .filter((candidate) => (candidate.price ?? 0) <= left + BUDGET_EPS)
      .sort((a, b) => (b.projectedFp ?? 0) - (a.projectedFp ?? 0))[0] ?? null;

  // El voraz ordena por puntos por crédito sin saber que el banquillo puntúa a
  // la mitad. La búsqueda local lo corrige: cambios sueltos y por parejas
  // (bajar a uno para subir a otro) mientras alguno mejore la puntuación real.
  if (players.length === SQUAD_SIZE && coach) {
    const improved = planTrades({ players, coach }, market, coachPool, budget, Infinity, 5, 0);
    return { players: improved.players, coach: improved.coach };
  }
  return { players, coach };
}

/* -------------------------------------------------------- plan de cambios */

/** Lo mínimo que tiene que ganar un cambio para proponerlo. Los cambios son
 *  un recurso (cuatro por jornada): gastar dos para ganar 0,02 puntos es
 *  ruido, no un consejo. */
export const MIN_GAIN_PER_TRADE = 0.5;

/** Jornadas tras las que el juego abre una ventana de cambios ilimitados en la
 *  fase regular (tras la 6, 13, 18, 23, 28 y 34). En playoffs, siempre. */
export const UNLIMITED_AFTER = [6, 13, 18, 23, 28, 34] as const;
/** Cambios por jornada fuera de esas ventanas. El entrenador cuenta como uno. */
export const TRADES_PER_ROUND = 4;

export interface TradeWindow {
  unlimited: boolean;
  /** Jornada tras la que se abre la próxima ventana ilimitada. */
  nextUnlimitedAfter: number | null;
}

/** `round` es la próxima jornada por jugar (la de `meta.currentRound`). */
export function tradeWindow(round: number, regularRounds: number): TradeWindow {
  const unlimited =
    round <= 1 ||
    (UNLIMITED_AFTER as readonly number[]).includes(round - 1) ||
    (regularRounds > 0 && round > regularRounds);
  const nextUnlimitedAfter = UNLIMITED_AFTER.find((after) => after + 1 > round) ?? null;
  return { unlimited, nextUnlimitedAfter };
}

export interface Lineup {
  players: Player[];
  coach: Player | null;
}

export interface TradeStep {
  /** Uno, o dos si solo tienen sentido juntos (vender barato para subir a otro). */
  trades: Array<{ out: Player; in: Player; costDelta: number }>;
  gain: number;
  /** Puntuación real de la plantilla tras el paso. */
  scored: number;
}

export interface TradePlan extends Lineup {
  steps: TradeStep[];
  before: number;
  after: number;
  used: number;
  spent: number;
}

function lineupScore(lineup: Lineup): number {
  return scoredProjection(assignRoles(lineup.players), lineup.coach);
}

function lineupSpent(lineup: Lineup): number {
  return lineup.players.reduce((sum, player) => sum + (player.price ?? 0), 0) + (lineup.coach?.price ?? 0);
}

function fichable(player: Player): boolean {
  return (player.price ?? 0) > 0 && player.projectedFp != null && isSignable(player);
}

/** Los que no están dominados: nadie más barato (o igual) proyecta más. Un
 *  dominado nunca es el mejor fichaje, salvo por el tope de club. */
function frontier(pool: Player[]): Player[] {
  const sorted = [...pool].sort(
    (a, b) => (a.price ?? 0) - (b.price ?? 0) || effectiveProjection(b) - effectiveProjection(a),
  );
  const out: Player[] = [];
  let best = -Infinity;
  for (const player of sorted) {
    const value = effectiveProjection(player);
    if (value > best + 1e-9) {
      out.push(player);
      best = value;
    }
  }
  return out;
}

type Move = Array<{ slot: number; in: Player }>;

interface Scored {
  move: Move;
  gain: number;
}

/** La puntuación real, en rápido. Con 4-4-2 en plantilla, el grupo del 100 %
 *  son los seis que más proyectan (salvo que falte un puesto, caso raro que va
 *  por `assignRoles`), y el capitán, el que más proyecta de todos:
 *
 *    0,5·Σ todos + 0,5·Σ los seis + máximo + entrenador
 *
 *  es lo mismo que `scoredProjection(assignRoles(...))` (lo comprueban los
 *  tests contra fuerza bruta), sin crear objetos: el planificador lo evalúa
 *  cientos de miles de veces. */
function fastScore(lineup: Lineup): number {
  const values = lineup.players.map(effectiveProjection);
  const order = values.map((_, index) => index).sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0));
  const top = order.slice(0, FULL_SCORERS);
  const covered = new Set(top.map((index) => lineup.players[index]?.position));
  const present = new Set(lineup.players.map((player) => player.position));
  for (const position of present) {
    if (!covered.has(position)) return lineupScore(lineup);
  }
  let total = 0;
  for (const value of values) total += value;
  let full = 0;
  for (const index of top) full += values[index] ?? 0;
  const captain = order.length ? (values[order[0] ?? 0] ?? 0) : 0;
  return 0.5 * total + 0.5 * full + captain + effectiveProjection(lineup.coach);
}

/** Inserta en una lista corta ordenada por ganancia, sin pasar de `size`. */
function keepTop(list: Scored[], item: Scored, size: number): void {
  if (list.length >= size && item.gain <= (list[list.length - 1]?.gain ?? -Infinity)) return;
  let index = list.length;
  while (index > 0 && (list[index - 1]?.gain ?? 0) < item.gain) index -= 1;
  list.splice(index, 0, item);
  if (list.length > size) list.pop();
}

/** Plan de cambios para la jornada: hasta `maxTrades` fichajes que más suben la
 *  puntuación real (capitán ×2, banquillo ×0,5, entrenador incluido), sin salirse
 *  del presupuesto ni del tope de seis por club.
 *
 *  Búsqueda en haz: de cada plantilla se prueban los mejores cambios sueltos y
 *  las mejores parejas (bajar a uno para poder subir a otro), y en cada número
 *  de cambios gastados se quedan las mejores plantillas. Mirar solo el mejor
 *  cambio de cada paso se dejaba hasta 6 puntos frente al óptimo exacto: gastar
 *  el dinero en el segundo mejor fichaje a veces deja sitio a un tercero.
 *
 *  Con cambios ilimitados (`Infinity`) se encadenan mejoras hasta que no queda
 *  ninguna. Los tests lo miden contra el óptimo exacto por programación entera.
 */
export function planTrades(
  start: Lineup,
  market: Player[],
  coaches: Player[],
  budget = DEFAULT_BUDGET,
  maxTrades: number = TRADES_PER_ROUND,
  beam = 5,
  minGainPerTrade = MIN_GAIN_PER_TRADE,
): TradePlan {
  const pools: Record<string, Player[]> = { G: [], F: [], C: [], E: [] };
  for (const player of market) if (player.position && fichable(player)) pools[player.position]?.push(player);
  for (const coach of coaches) if (fichable(coach)) pools.E?.push(coach);

  const origin: Lineup = { players: [...start.players], coach: start.coach };
  const before = lineupScore(origin);

  const slotOf = (lineup: Lineup, slot: number): Player | null =>
    slot < lineup.players.length ? (lineup.players[slot] ?? null) : lineup.coach;
  const posOf = (lineup: Lineup, slot: number): string =>
    slot < lineup.players.length ? (lineup.players[slot]?.position ?? "") : "E";
  const slotCount = (lineup: Lineup): number => lineup.players.length + (lineup.coach ? 1 : 0);
  const apply = (lineup: Lineup, move: Move): Lineup => {
    const players = [...lineup.players];
    let coach = lineup.coach;
    for (const { slot, in: incoming } of move) {
      if (slot < players.length) players[slot] = incoming;
      else coach = incoming;
    }
    return { players, coach };
  };
  const clubsOk = (lineup: Lineup): boolean => {
    const clubs: Record<string, number> = {};
    for (const player of lineup.players) {
      const club = player.club ?? "";
      clubs[club] = (clubs[club] ?? 0) + 1;
      if (clubs[club] > MAX_PER_CLUB) return false;
    }
    return true;
  };

  /** Los `size` mejores cambios sueltos. */
  const singles = (lineup: Lineup, size: number): Scored[] => {
    const owned = new Set([...lineup.players.map((p) => p.id), lineup.coach?.id]);
    const base = fastScore(lineup);
    const spent = lineupSpent(lineup);
    const out: Scored[] = [];
    for (let slot = 0; slot < slotCount(lineup); slot += 1) {
      const leaving = slotOf(lineup, slot);
      if (!leaving) continue;
      for (const candidate of pools[posOf(lineup, slot)] ?? []) {
        if (owned.has(candidate.id)) continue;
        // Con menos proyección no puede subir la puntuación (es monótona).
        if (effectiveProjection(candidate) <= effectiveProjection(leaving)) continue;
        if (spent - (leaving.price ?? 0) + (candidate.price ?? 0) > budget + BUDGET_EPS) continue;
        const move: Move = [{ slot, in: candidate }];
        const next = apply(lineup, move);
        if (slot < lineup.players.length && !clubsOk(next)) continue;
        const gain = fastScore(next) - base;
        if (gain > 1e-6) keepTop(out, { move, gain }, size);
      }
    }
    return out;
  };

  /** Las `size` mejores parejas, con fichajes solo de la frontera precio-puntos. */
  const pairs = (lineup: Lineup, size: number): Scored[] => {
    const owned = new Set([...lineup.players.map((p) => p.id), lineup.coach?.id]);
    const base = fastScore(lineup);
    const spent = lineupSpent(lineup);
    const fronts: Record<string, Player[]> = {};
    for (const [key, pool] of Object.entries(pools)) {
      fronts[key] = frontier(pool.filter((player) => !owned.has(player.id)));
    }
    const out: Scored[] = [];
    const slots = slotCount(lineup);
    for (let a = 0; a < slots; a += 1) {
      const outA = slotOf(lineup, a);
      if (!outA) continue;
      for (let b = a + 1; b < slots; b += 1) {
        const outB = slotOf(lineup, b);
        if (!outB) continue;
        const room = budget + BUDGET_EPS - spent + (outA.price ?? 0) + (outB.price ?? 0);
        for (const inA of fronts[posOf(lineup, a)] ?? []) {
          const upA = effectiveProjection(inA) > effectiveProjection(outA);
          const left = room - (inA.price ?? 0);
          if (left < 0) break; // la frontera va de barato a caro
          for (const inB of fronts[posOf(lineup, b)] ?? []) {
            if ((inB.price ?? 0) > left) break;
            if (inA.id === inB.id) continue;
            if (!upA && effectiveProjection(inB) <= effectiveProjection(outB)) continue;
            const move: Move = [
              { slot: a, in: inA },
              { slot: b, in: inB },
            ];
            const next = apply(lineup, move);
            if (!clubsOk(next)) continue;
            const gain = fastScore(next) - base;
            if (gain > 1e-6) keepTop(out, { move, gain }, size);
          }
        }
      }
    }
    return out;
  };

  interface State {
    lineup: Lineup;
    score: number;
    path: Move[];
  }
  const key = (lineup: Lineup): string =>
    [...lineup.players.map((p) => p.id)].sort((x, y) => x - y).join(",") + `|${lineup.coach?.id ?? ""}`;

  let best: State = { lineup: origin, score: fastScore(origin), path: [] };

  const changes = (lineup: Lineup): number => {
    let count = lineup.coach?.id !== origin.coach?.id ? 1 : 0;
    lineup.players.forEach((player, slot) => {
      if (player.id !== origin.players[slot]?.id) count += 1;
    });
    return count;
  };

  /** Pulido: re-elegir (o deshacer) dos plazas a la vez sin pasar de los
   *  cambios permitidos. El haz construye el plan fichaje a fichaje; esto
   *  recoloca lo ya decidido, que es donde se le escapaban puntos. */
  const polish = (state: State): State => {
    let lineup = state.lineup;
    let score = fastScore(lineup);
    for (let round = 0; round < 12; round += 1) {
      const owned = new Set([...lineup.players.map((p) => p.id), lineup.coach?.id]);
      const fronts: Record<string, Player[]> = {};
      for (const [pos, pool] of Object.entries(pools)) {
        fronts[pos] = frontier(pool.filter((player) => !owned.has(player.id)));
      }
      const options = (slot: number): Player[] => {
        const original = slotOf(origin, slot);
        const list = [...(fronts[posOf(lineup, slot)] ?? [])];
        if (original && !owned.has(original.id)) list.push(original);
        return list;
      };
      const spent = lineupSpent(lineup);
      let found: { lineup: Lineup; score: number } | null = null;
      const slots = slotCount(lineup);
      for (let a = 0; a < slots; a += 1) {
        const outA = slotOf(lineup, a) as Player;
        const listA = options(a);
        for (let b = a; b < slots; b += 1) {
          const outB = slotOf(lineup, b) as Player;
          const listB = b === a ? [null] : [null, ...options(b)];
          for (const inA of listA) {
            for (const inB of listB) {
              if (inB && inA.id === inB.id) continue;
              const cost =
                spent - (outA.price ?? 0) + (inA.price ?? 0) + (inB ? (inB.price ?? 0) - (outB.price ?? 0) : 0);
              if (cost > budget + BUDGET_EPS) continue;
              const move: Move = inB ? [{ slot: a, in: inA }, { slot: b, in: inB }] : [{ slot: a, in: inA }];
              const next = apply(lineup, move);
              if (changes(next) > maxTrades || !clubsOk(next)) continue;
              const value = fastScore(next);
              if (value > (found?.score ?? score) + 1e-6) found = { lineup: next, score: value };
            }
          }
        }
      }
      if (!found) break;
      lineup = found.lineup;
      score = found.score;
    }
    if (lineup === state.lineup) return state;
    // El camino se rehace desde el origen: un cambio por plaza distinta.
    const path: Move[] = [];
    lineup.players.forEach((player, slot) => {
      if (player.id !== origin.players[slot]?.id) path.push([{ slot, in: player }]);
    });
    if (lineup.coach && lineup.coach.id !== origin.coach?.id) {
      path.push([{ slot: origin.players.length, in: lineup.coach }]);
    }
    return { lineup, score, path };
  };

  if (Number.isFinite(maxTrades)) {
    // Haz: layers[u] = mejores plantillas con u cambios gastados.
    const layers: State[][] = Array.from({ length: maxTrades + 1 }, () => []);
    layers[0] = [best];
    for (let used = 0; used < maxTrades; used += 1) {
      const layer = (layers[used] ?? []).sort((x, y) => y.score - x.score).slice(0, beam);
      for (const state of layer) {
        if (state.score > best.score + 1e-9) best = state;
        const expansions: Array<{ scored: Scored; cost: number }> = singles(state.lineup, beam).map(
          (scored) => ({ scored, cost: 1 }),
        );
        if (maxTrades - used >= 2) {
          for (const scored of pairs(state.lineup, beam)) expansions.push({ scored, cost: 2 });
        }
        for (const { scored, cost } of expansions) {
          const lineup = apply(state.lineup, scored.move);
          layers[used + cost]?.push({ lineup, score: state.score + scored.gain, path: [...state.path, scored.move] });
        }
      }
      // Sin duplicados: dos órdenes de los mismos cambios son la misma plantilla.
      for (let next = used + 1; next <= maxTrades; next += 1) {
        const seen = new Set<string>();
        layers[next] = (layers[next] ?? []).filter((state) => {
          const id = key(state.lineup);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      }
    }
    for (const state of layers[maxTrades] ?? []) if (state.score > best.score + 1e-9) best = state;
    best = polish(best);
  } else {
    // Ilimitados: mejor cambio (o pareja) cada vez, hasta que no quede mejora.
    for (let guard = 0; guard < 40; guard += 1) {
      const move = [...singles(best.lineup, 1), ...pairs(best.lineup, 1)].sort((x, y) => y.gain - x.gain)[0];
      if (!move) break;
      best = { lineup: apply(best.lineup, move.move), score: best.score + move.gain, path: [...best.path, move.move] };
    }
  }

  // El camino, en el orden en que conviene hacerlo: primero el que más gana
  // de los que caben con el dinero de ese momento (así, si al final solo haces
  // uno, es el bueno). Siempre existe un orden así: si todos los que quedan
  // cuestan dinero, cualquiera cabe, porque juntos caben. Las parejas van
  // juntas y con la venta barata delante.
  const steps: TradeStep[] = [];
  const before_: Lineup[] = [];
  let current = origin;
  const pending = [...best.path];
  while (pending.length) {
    const base = lineupScore(current);
    let pick = -1;
    let pickGain = -Infinity;
    pending.forEach((move, index) => {
      const next = apply(current, move);
      // Cada paso tiene que ser válido por sí solo: el juego no deja pasarse
      // del presupuesto ni tener siete de un club ni un momento.
      if (lineupSpent(next) > budget + BUDGET_EPS || !clubsOk(next)) return;
      const gain = lineupScore(next) - base;
      if (gain > pickGain) {
        pick = index;
        pickGain = gain;
      }
    });
    if (pick < 0) pick = 0;
    const move = pending.splice(pick, 1)[0] as Move;
    const trades = move
      .map(({ slot, in: incoming }) => {
        const out = slotOf(current, slot) as Player;
        return { out, in: incoming, costDelta: Number(((incoming.price ?? 0) - (out.price ?? 0)).toFixed(2)) };
      })
      .sort((x, y) => x.costDelta - y.costDelta);
    before_.push(current);
    current = apply(current, move);
    const scored = lineupScore(current);
    steps.push({ trades, gain: Number((scored - base).toFixed(2)), scored: Number(scored.toFixed(2)) });
  }
  // Los pasos que casi no ganan se quitan por el final: por el orden de arriba
  // son los últimos, y quitarlos no deja a ninguno anterior sin dinero.
  while (steps.length) {
    const last = steps[steps.length - 1] as TradeStep;
    const previous = before_[before_.length - 1] ?? origin;
    if (last.gain >= minGainPerTrade * last.trades.length || !clubsOk(previous)) break;
    steps.pop();
    before_.pop();
    current = previous;
  }

  return {
    ...current,
    steps,
    before: Number(before.toFixed(2)),
    after: Number(lineupScore(current).toFixed(2)),
    used: steps.reduce((sum, step) => sum + step.trades.length, 0),
    spent: Number(lineupSpent(current).toFixed(2)),
  };
}

/* ------------------------------------------------------------ roster real */

/** Extrae ids de jugador de la respuesta del roster de Fantaking.
 *
 *  La forma exacta del payload no está documentada, así que en vez de asumir
 *  una estructura se recorre el JSON entero y se quedan los `id` numéricos que
 *  existen en nuestro mercado. Si Fantaking reorganiza la respuesta, esto
 *  sigue funcionando. `known` debe incluir a los entrenadores: también son
 *  fichas del mercado.
 */
export function extractRosterIds(payload: unknown, known: Set<number>): number[] {
  const found = new Set<number>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of ["id", "player_id", "playerId"]) {
        const value = record[key];
        if (typeof value === "number" && known.has(value)) found.add(value);
      }
      Object.values(record).forEach(walk);
    }
  };

  walk(payload);
  return [...found];
}

export function positionWord(position: string): string {
  return position === "G" ? "bases" : position === "F" ? "aleros" : "pívots";
}
