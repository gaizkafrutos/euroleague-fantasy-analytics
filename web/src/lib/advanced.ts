/** Utilidades de la capa avanzada: escalas de color, temporadas y la
 *  distribución de puntuación de una plantilla.
 *
 *  Las escalas devuelven un ÍNDICE de clase, no un color: el color lo pone el
 *  CSS con los tokens validados (--div-* y --seq-*), que cambian con el tema.
 */
// `meta.json` directo y no `./data`: este módulo lo usan componentes de cliente,
// y `./data` arrastra `players.json` entero al bundle del navegador.
import metaJson from "@/data/meta.json";

import type { Meta, Player } from "./types";

const meta = metaJson as unknown as Meta;

/* ------------------------------------------------------------- temporadas */

export function seasonLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return meta.league?.seasonLabels?.[code] ?? `${code.slice(1)}-${String(Number(code.slice(1)) + 1).slice(-2)}`;
}

/** ["E2025", "E2026"] -> "2025-26 y 2026-27". */
export function seasonsLabel(codes: string[] | null | undefined): string {
  if (!codes?.length) return "—";
  const labels = codes.map(seasonLabel);
  return labels.length === 1 ? labels[0]! : `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

export const CURRENT_SEASON = meta.season;

/* ---------------------------------------------------------------- escalas */

/** Divergente frente a una referencia: −2 … +2 (0 = en la media).
 *  `step` es la anchura de la clase central y de cada escalón. */
export function divergingClass(delta: number | null | undefined, step: number): -2 | -1 | 0 | 1 | 2 {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return 0;
  if (delta >= step * 2.5) return 2;
  if (delta >= step * 0.5) return 1;
  if (delta <= -step * 2.5) return -2;
  if (delta <= -step * 0.5) return -1;
  return 0;
}

/** Percentil (0–1) a clase divergente: 50 es neutro, 90+ y 10- los extremos. */
export function percentileClass(pct: number | null | undefined): -2 | -1 | 0 | 1 | 2 {
  if (pct === null || pct === undefined) return 0;
  if (pct >= 0.85) return 2;
  if (pct >= 0.62) return 1;
  if (pct <= 0.15) return -2;
  if (pct <= 0.38) return -1;
  return 0;
}

/** Índice frente a la media (1 = media) a clase secuencial 1–5. */
export function sequentialClass(index: number | null | undefined): 1 | 2 | 3 | 4 | 5 {
  if (index === null || index === undefined) return 3;
  if (index >= 1.1) return 5;
  if (index >= 1.035) return 4;
  if (index > 0.965) return 3;
  if (index > 0.9) return 2;
  return 1;
}

/* ------------------------------------------------------------------ precio */

/** Puntos fantasy con los que un precio concreto no se mueve. */
export function breakEvenAt(price: number): number | null {
  const model = meta.priceModel;
  if (!model || model.a <= 0) return null;
  return (-model.c - model.b * price) / model.a;
}

/* ------------------------------------------- distribución de la plantilla */

/** Φ⁻¹ para los percentiles que se enseñan. */
const Z = { p10: 1.2816, p25: 0.6745 };

export interface ScoreRange {
  mean: number;
  sd: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

/** Desviación típica con la que puntúa un jugador: la del pipeline; si no la
 *  hay, la mitad de su proyección. De baja, 0: no va a sumar nada. */
export function sdOf(player: Player, expected: number): number {
  if (player.availability?.level === "out") return 0;
  return player.outlook?.sd ?? Math.max(3, 0.5 * expected);
}

/** Rango de puntuación de una plantilla: suma de normales independientes, cada
 *  una con su multiplicador (capitán ×2, banquillo ×0,5). Es optimista —en la
 *  realidad los de un mismo equipo se mueven juntos— y se dice en la página. */
export function squadRange(
  entries: Array<{ multiplier: number; mean: number; sd: number }>,
): ScoreRange | null {
  if (!entries.length) return null;
  let mean = 0;
  let variance = 0;
  for (const { multiplier, mean: expected, sd } of entries) {
    mean += multiplier * expected;
    variance += (multiplier * sd) ** 2;
  }
  const sd = Math.sqrt(variance);
  return {
    mean,
    sd,
    p10: mean - Z.p10 * sd,
    p25: mean - Z.p25 * sd,
    p75: mean + Z.p25 * sd,
    p90: mean + Z.p10 * sd,
  };
}
