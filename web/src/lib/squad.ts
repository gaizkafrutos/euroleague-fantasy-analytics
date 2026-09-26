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
  if (spent > budget)
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
      if ((candidate.price ?? Infinity) > ceiling) continue;
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
      .filter((candidate) => (candidate.price ?? 0) <= left + 1e-9)
      .sort((a, b) => (b.projectedFp ?? 0) - (a.projectedFp ?? 0))[0] ?? null;

  return { players, coach };
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
