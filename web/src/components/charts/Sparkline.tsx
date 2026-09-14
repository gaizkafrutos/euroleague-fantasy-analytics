/** Sparkline de las últimas actuaciones.
 *
 *  Va dentro de una celda de tabla: sin ejes, sin leyenda, sin tooltip propio
 *  (la fila entera enlaza a la ficha, donde el mismo dato sí es interactivo).
 *  Marca el último partido con un punto para que se lea la dirección.
 */
import { linePath } from "./scales";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
}

export default function Sparkline({ values, width = 78, height = 22, label }: Props) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) {
    return <span className="muted">—</span>;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = clean.length > 1 ? (width - 4) / (clean.length - 1) : 0;

  const points = clean.map((value, index): [number, number] => [
    2 + index * step,
    height - 3 - ((value - min) / span) * (height - 6),
  ]);

  const last = points[points.length - 1];
  const rising = clean[clean.length - 1] >= clean[0];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={label ?? `Últimos ${clean.length} partidos`}
      role="img"
      style={{ overflow: "visible", verticalAlign: "middle" }}
    >
      <path
        d={linePath(points)}
        fill="none"
        stroke={rising ? "var(--series-3)" : "var(--ink-muted)"}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={2.6}
        fill={rising ? "var(--series-3)" : "var(--ink-muted)"}
        stroke="var(--surface)"
        strokeWidth={1.4}
      />
    </svg>
  );
}
