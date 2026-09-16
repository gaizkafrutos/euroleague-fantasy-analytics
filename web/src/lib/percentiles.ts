/** Percentiles por posición.
 *
 *  "23,8 de media" no le dice nada a nadie que no se sepa la liga de memoria.
 *  "Top 4% de los aleros" sí. Es el mismo número con el contexto que lo
 *  convierte en un juicio.
 *
 *  Se calcula aquí y no en el pipeline a propósito: es una derivada pura del
 *  JSON que ya existe, así que no hace falta regenerar nada para tenerla. Se
 *  evalúa una sola vez, al cargar el módulo, en tiempo de build.
 */
import { pricedPlayers, rosterPlayers } from "./data";
import type { Player, Position } from "./types";

export type PercentileKey =
  | "projectedFp"
  | "fpAvg"
  | "valueProjected"
  | "consistency"
  | "minutesAvg"
  | "bargainScore";

/** Lo que se compara, y el nombre con el que se enseña. */
export const PERCENTILE_LABEL: Record<PercentileKey, string> = {
  projectedFp: "Proyección",
  fpAvg: "Media",
  valueProjected: "Puntos por crédito",
  consistency: "Fiabilidad",
  minutesAvg: "Minutos",
  bargainScore: "Índice de chollo",
};

function metric(player: Player, key: PercentileKey): number | null {
  const raw = (() => {
    switch (key) {
      case "projectedFp":
        return player.projectedFp;
      case "fpAvg":
        return player.perf.fpAvg;
      case "valueProjected":
        return player.valueProjected ?? player.valuePerCredit;
      case "consistency":
        return player.perf.consistency;
      case "minutesAvg":
        return player.perf.minutesAvg;
      case "bargainScore":
        return player.bargainScore;
    }
  })();
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

const KEYS: PercentileKey[] = [
  "projectedFp",
  "fpAvg",
  "valueProjected",
  "consistency",
  "minutesAvg",
  "bargainScore",
];

/** El grupo contra el que se compara: su misma posición, con partidos jugados.
 *
 *  Meter en la referencia a quien no ha jugado inflaría cualquier percentil —
 *  sería fácil estar en el top 20% de un grupo lleno de ceros. */
const universe: Player[] = (pricedPlayers.length ? pricedPlayers : rosterPlayers).filter(
  (player) => (player.perf.gamesPlayed ?? 0) > 0,
);

type Pool = { sorted: Record<PercentileKey, number[]>; size: number };

const pools = new Map<Position, Pool>();

for (const position of ["G", "F", "C"] as const) {
  const group = universe.filter((player) => player.position === position);
  const sorted = {} as Record<PercentileKey, number[]>;
  for (const key of KEYS) {
    sorted[key] = group
      .map((player) => metric(player, key))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
  }
  pools.set(position, { sorted, size: group.length });
}

/** Percentil 0–1 con corrección de empates (mitad de los iguales cuenta). */
function rank(values: number[], value: number): number | null {
  if (values.length < 6) return null; // con menos de seis, el percentil miente
  let below = 0;
  let equal = 0;
  for (const candidate of values) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
    else break; // está ordenado
  }
  return (below + equal / 2) / values.length;
}

/** Percentil del jugador en esa métrica, dentro de su posición. */
export function percentileOf(player: Player, key: PercentileKey): number | null {
  if (!player.position) return null;
  const pool = pools.get(player.position);
  const value = metric(player, key);
  if (!pool || value === null) return null;
  return rank(pool.sorted[key], value);
}

/** Cuántos jugadores forman el grupo de comparación. */
export function poolSize(position: Position | null): number {
  return position ? (pools.get(position)?.size ?? 0) : 0;
}

/** Percentiles listos para pintar en la ficha. */
export interface PercentileRow {
  key: PercentileKey;
  label: string;
  percentile: number;
}

export function percentileRows(player: Player, keys: PercentileKey[]): PercentileRow[] {
  return keys
    .map((key) => ({ key, label: PERCENTILE_LABEL[key], percentile: percentileOf(player, key) }))
    .filter((row): row is PercentileRow => row.percentile !== null);
}
