/** Formateo consistente en toda la app. Un número mal formateado es ruido. */

const decimal = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const decimal2 = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (digits === 0) return integer.format(value);
  if (digits === 2) return decimal2.format(value);
  return decimal.format(value);
}

export function credits(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${decimal.format(value)} cr`;
}

export function signed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatted = digits === 2 ? decimal2.format(Math.abs(value)) : decimal.format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(value * 100)}%`;
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(parsed);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export const POSITION_LABEL: Record<string, string> = {
  G: "Base",
  F: "Alero",
  C: "Pívot",
};

export const POSITION_PLURAL: Record<string, string> = {
  G: "Bases",
  F: "Aleros",
  C: "Pívots",
};

export function positionLabel(position: string | null | undefined): string {
  if (!position) return "—";
  return POSITION_LABEL[position] ?? position;
}

/** Clase CSS para un delta, según signo. */
export function deltaClass(value: number | null | undefined, epsilon = 0.001): string {
  if (value === null || value === undefined || Math.abs(value) < epsilon) return "delta delta-flat";
  return value > 0 ? "delta delta-up" : "delta delta-down";
}
