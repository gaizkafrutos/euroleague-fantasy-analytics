/** Reglas del juego y análisis de plantilla, en cliente.
 *
 *  Duplica a propósito parte de la lógica del optimizador Python: aquí el
 *  objetivo es que mover un deslizador de presupuesto responda al instante,
 *  no calcular el óptimo demostrable. El pipeline manda; esto acompaña.
 */
import type { Player } from "./types";

export const QUOTA = { G: 4, F: 4, C: 2 } as const;
export const SQUAD_SIZE = QUOTA.G + QUOTA.F + QUOTA.C;
export const MAX_PER_CLUB = 6;
export const DEFAULT_BUDGET = 100;

export interface SquadCheck {
  valid: boolean;
  spent: number;
  free: number;
  problems: string[];
  counts: Record<string, number>;
  clubCounts: Record<string, number>;
  projection: number;
}

export function checkSquad(squad: Player[], budget = DEFAULT_BUDGET): SquadCheck {
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  const clubCounts: Record<string, number> = {};
  let spent = 0;
  let projection = 0;

  for (const player of squad) {
    if (player.position) counts[player.position] = (counts[player.position] ?? 0) + 1;
    if (player.club) clubCounts[player.club] = (clubCounts[player.club] ?? 0) + 1;
    spent += player.price ?? 0;
    projection += player.projectedFp ?? 0;
  }

  const problems: string[] = [];
  for (const [position, quota] of Object.entries(QUOTA)) {
    const have = counts[position] ?? 0;
    if (have > quota) problems.push(`Sobran ${have - quota} en ${positionWord(position)}.`);
    if (have < quota && squad.length >= SQUAD_SIZE)
      problems.push(`Faltan ${quota - have} en ${positionWord(position)}.`);
  }
  for (const [club, count] of Object.entries(clubCounts)) {
    if (count > MAX_PER_CLUB) problems.push(`${count} jugadores de ${club}: el máximo es ${MAX_PER_CLUB}.`);
  }
  if (spent > budget) problems.push(`Te pasas ${(spent - budget).toFixed(1)} créditos del presupuesto.`);

  return {
    valid: problems.length === 0 && squad.length === SQUAD_SIZE,
    spent: Number(spent.toFixed(2)),
    free: Number((budget - spent).toFixed(2)),
    problems,
    counts,
    clubCounts,
    projection: Number(projection.toFixed(2)),
  };
}

export interface Swap {
  out: Player;
  in: Player;
  gain: number;
  costDelta: number;
}

/** Para cada jugador de la plantilla, el mejor recambio asequible de su puesto. */
export function suggestSwaps(
  squad: Player[],
  market: Player[],
  budget = DEFAULT_BUDGET,
  limit = 5,
): Swap[] {
  const owned = new Set(squad.map((player) => player.id));
  const check = checkSquad(squad, budget);

  const suggestions: Swap[] = [];
  for (const player of squad) {
    const ceiling = (player.price ?? 0) + check.free;
    let best: Player | null = null;

    for (const candidate of market) {
      if (owned.has(candidate.id)) continue;
      if (candidate.position !== player.position) continue;
      if ((candidate.price ?? Infinity) > ceiling) continue;
      if ((candidate.projectedFp ?? 0) <= (player.projectedFp ?? 0)) continue;

      const clubCount =
        (check.clubCounts[candidate.club ?? ""] ?? 0) -
        (candidate.club === player.club ? 1 : 0);
      if (clubCount >= MAX_PER_CLUB) continue;

      if (!best || (candidate.projectedFp ?? 0) > (best.projectedFp ?? 0)) best = candidate;
    }

    if (best) {
      suggestions.push({
        out: player,
        in: best,
        gain: Number(((best.projectedFp ?? 0) - (player.projectedFp ?? 0)).toFixed(2)),
        costDelta: Number(((best.price ?? 0) - (player.price ?? 0)).toFixed(2)),
      });
    }
  }

  return suggestions.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

/** Voraz con reserva de presupuesto: la misma idea que el fallback del pipeline. */
export function buildSquad(market: Player[], budget = DEFAULT_BUDGET): Player[] {
  const pool = market
    .filter((player) => player.position && (player.price ?? 0) > 0 && player.projectedFp != null)
    .sort(
      (a, b) =>
        (b.projectedFp ?? 0) / (b.price ?? 1) - (a.projectedFp ?? 0) / (a.price ?? 1),
    );

  const cheapest: Record<string, number[]> = { G: [], F: [], C: [] };
  for (const position of Object.keys(QUOTA)) {
    cheapest[position] = pool
      .filter((player) => player.position === position)
      .map((player) => player.price ?? 0)
      .sort((a, b) => a - b);
  }

  const squad: Player[] = [];
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  const clubCounts: Record<string, number> = {};
  let spent = 0;

  const reserveAfter = (skip: string): number => {
    let total = 0;
    for (const [position, quota] of Object.entries(QUOTA)) {
      let missing = quota - (counts[position] ?? 0);
      if (position === skip) missing -= 1;
      if (missing <= 0) continue;
      total += cheapest[position].slice(0, missing).reduce((sum, price) => sum + price, 0);
    }
    return total;
  };

  for (const player of pool) {
    const position = player.position as keyof typeof QUOTA;
    if (squad.length >= SQUAD_SIZE) break;
    if ((counts[position] ?? 0) >= QUOTA[position]) continue;
    if ((clubCounts[player.club ?? ""] ?? 0) >= MAX_PER_CLUB) continue;
    const price = player.price ?? 0;
    if (spent + price + reserveAfter(position) > budget) continue;

    squad.push(player);
    counts[position] = (counts[position] ?? 0) + 1;
    clubCounts[player.club ?? ""] = (clubCounts[player.club ?? ""] ?? 0) + 1;
    spent += price;
  }

  return squad;
}

/** Extrae ids de jugador de la respuesta del roster de Fantaking.
 *
 *  La forma exacta del payload no está documentada, así que en vez de asumir
 *  una estructura se recorre el JSON entero y se quedan los `id` numéricos que
 *  existen en nuestro mercado. Si Fantaking reorganiza la respuesta, esto
 *  sigue funcionando.
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
