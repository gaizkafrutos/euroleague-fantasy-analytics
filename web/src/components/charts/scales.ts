/** Escalas mínimas para SVG. No hace falta una librería de gráficos para esto,
 *  y escribirlas a mano da control total sobre los márgenes y los ticks. */

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
  invert: (pixel: number) => number;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;

  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.domain = domain;
  scale.range = range;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  return scale;
}

/** Extremos de una serie, con un margen para que las marcas no toquen el borde. */
export function extent(values: number[], padRatio = 0.06): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return [0, 1];
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const delta = Math.abs(min) * 0.1 || 1;
    min -= delta;
    max += delta;
  }
  const pad = (max - min) * padRatio;
  return [min - pad, max + pad];
}

/** Ticks "redondos" dentro de un dominio. */
export function ticks(domain: [number, number], count = 5): number[] {
  const [min, max] = domain;
  const span = max - min;
  if (span <= 0) return [min];
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;

  const out: number[] = [];
  for (let value = start; value <= max + step * 1e-6; value += step) {
    out.push(Number(value.toFixed(10)));
  }
  return out;
}

/** Path de una polilínea. */
export function linePath(points: Array<[number, number]>): string {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

export const CHART_MARGIN = { top: 14, right: 16, bottom: 30, left: 42 };
