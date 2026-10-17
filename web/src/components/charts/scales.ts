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

/** Paso "redondo" (1, 2 o 5 por potencia de diez) para unas `count` marcas. */
export function tickStep(domain: [number, number], count = 5): number {
  const span = domain[1] - domain[0];
  if (span <= 0) return 1;
  const rawStep = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  return (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * magnitude;
}

/** Ticks "redondos" dentro de un dominio. */
export function ticks(domain: [number, number], count = 5): number[] {
  const [min, max] = domain;
  const span = max - min;
  if (span <= 0) return [min];
  const step = tickStep(domain, count);
  const start = Math.ceil(min / step) * step;

  const out: number[] = [];
  for (let value = start; value <= max + step * 1e-6; value += step) {
    out.push(Number(value.toFixed(10)));
  }
  return out;
}

/** Etiqueta de una marca del eje, con los decimales que pide su paso y en
 *  formato español. Con un paso de 0,02 salen dos decimales: redondear todas a
 *  uno daba ejes como "14,9 · 14,9 · 14,9". */
export function tickLabel(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Path de una polilínea. */
export function linePath(points: Array<[number, number]>): string {
  if (!points.length) return "";
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

/** Barra vertical con la punta (el extremo del dato) redondeada y la base
 *  recta sobre la línea de cero. `y0` es la base; `y1`, la punta. */
export function barPath(x: number, width: number, y0: number, y1: number, radius = 4): string {
  const height = Math.abs(y1 - y0);
  const r = Math.min(radius, width / 2, height);
  const right = x + width;
  if (y1 <= y0) {
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${right - r} Q${right},${y1} ${right},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${right - r} Q${right},${y1} ${right},${y1 - r} V${y0} Z`;
}

export const CHART_MARGIN ={ top: 14, right: 16, bottom: 30, left: 42 };
