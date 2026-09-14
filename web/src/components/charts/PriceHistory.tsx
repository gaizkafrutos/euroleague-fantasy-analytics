"use client";

/** Evolución del precio de un jugador, con crosshair y tooltip.
 *
 *  Una sola serie: sin leyenda (el título la nombra), con la línea de precio de
 *  salida como referencia para que se lea de un vistazo si el jugador ha subido
 *  o bajado desde el inicio de temporada.
 */
import { useState } from "react";

import { credits, dateShort, signed } from "@/lib/format";
import type { PricePoint } from "@/lib/types";
import { CHART_MARGIN, extent, linePath, linearScale, ticks } from "./scales";

interface Props {
  points: PricePoint[];
  height?: number;
}

export default function PriceHistory({ points, height = 220 }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const width = 720;

  if (points.length < 2) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Hace falta más de un snapshot para dibujar la evolución. El histórico se
        construye solo, una captura por jornada.
      </p>
    );
  }

  const values = points.map((point) => point.q);
  const yDomain = extent(values, 0.12);
  const x = linearScale([0, points.length - 1], [CHART_MARGIN.left, width - CHART_MARGIN.right]);
  const y = linearScale(yDomain, [height - CHART_MARGIN.bottom, CHART_MARGIN.top]);

  const path = linePath(points.map((point, index): [number, number] => [x(index), y(point.q)]));
  const open = values[0];
  const current = values[values.length - 1];

  return (
    <div className="chart-frame">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Evolución del precio en créditos"
        onMouseLeave={() => setActive(null)}
      >
        {ticks(yDomain, 4).map((tick) => (
          <g key={tick}>
            <line
              className="grid-line"
              x1={CHART_MARGIN.left}
              x2={width - CHART_MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text x={CHART_MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Precio de salida */}
        <line
          x1={CHART_MARGIN.left}
          x2={width - CHART_MARGIN.right}
          y1={y(open)}
          y2={y(open)}
          stroke="var(--axis)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        <path className="series-line" d={path} stroke="var(--series-1)" />

        {points.map((point, index) => (
          <circle
            key={point.t}
            cx={x(index)}
            cy={y(point.q)}
            r={active === index ? 6 : 4}
            fill="var(--series-1)"
            stroke="var(--surface)"
            strokeWidth={2}
            onMouseEnter={() => setActive(index)}
          />
        ))}

        {active !== null ? (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={CHART_MARGIN.top}
            y2={height - CHART_MARGIN.bottom}
            stroke="var(--rule)"
            strokeWidth={1}
          />
        ) : null}

        <line
          className="axis-line"
          x1={CHART_MARGIN.left}
          x2={width - CHART_MARGIN.right}
          y1={height - CHART_MARGIN.bottom}
          y2={height - CHART_MARGIN.bottom}
        />

        {points.map((point, index) =>
          index === 0 || index === points.length - 1 || points.length < 8 ? (
            <text
              key={`t-${point.t}`}
              x={x(index)}
              y={height - CHART_MARGIN.bottom + 15}
              textAnchor="middle"
            >
              {dateShort(point.t)}
            </text>
          ) : null,
        )}
      </svg>

      {active !== null ? (
        <div
          className="tooltip"
          style={{
            left: `${(x(active) / width) * 100}%`,
            top: `${(y(points[active].q) / height) * 100}%`,
          }}
        >
          <div className="tooltip-title num">{credits(points[active].q)}</div>
          <div className="muted">{dateShort(points[active].t)}</div>
        </div>
      ) : null}

      <p className="card-note" style={{ marginTop: 8, marginBottom: 0 }}>
        La línea discontinua es el precio de salida ({credits(open)}). Ahora mismo:{" "}
        <strong className="num">{credits(current)}</strong> ({signed(current - open)} cr).
      </p>
    </div>
  );
}
