"use client";

/** El once óptimo de cada jornada: lo que proyectaba la web y lo que puntuó.
 *
 *  Dos columnas por jornada (proyectado en gris, real en naranja) y una raya
 *  con el mejor once posible sabiendo ya los resultados, que da la escala: la
 *  distancia entre la columna naranja y la raya es lo que nadie podía saber.
 */
import { useState } from "react";

import { num } from "@/lib/format";
import { barPath, linearScale, tickLabel, tickStep, ticks } from "./scales";
import { useChartWidth } from "./useChartWidth";

export interface LineupRound {
  round: number;
  projected: number;
  real: number;
  best: number | null;
}

const MARGIN = { top: 14, right: 12, bottom: 30, left: 40 };
const GAP = 2;

export default function LineupRounds({ rows, height = 240 }: { rows: LineupRound[]; height?: number }) {
  const [frameRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...rows.flatMap((r) => [r.projected, r.real, r.best ?? 0])) * 1.08;
  const domain: [number, number] = [0, max];
  const step = tickStep(domain, 4);
  const y = linearScale(domain, [height - MARGIN.bottom, MARGIN.top]);
  const slot = (width - MARGIN.left - MARGIN.right) / Math.max(rows.length, 1);
  const bar = Math.max(6, Math.min(24, (slot - 16) / 2 - GAP));
  const centre = (i: number) => MARGIN.left + slot * (i + 0.5);
  const zero = y(0);
  const lastIndex = rows.length - 1;

  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        <span>
          <i className="legend-swatch" style={{ background: "var(--ink-3)" }} aria-hidden />
          Proyectado
        </span>
        <span>
          <i className="legend-swatch" style={{ background: "var(--brand)" }} aria-hidden />
          Real
        </span>
        <span>
          <i className="legend-key" style={{ background: "var(--ink)" }} aria-hidden />
          Mejor once posible (a toro pasado)
        </span>
      </div>
      <div ref={frameRef} className="chart-frame">
        <svg
          className="chart is-px"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Puntos del once óptimo por jornada: proyectados, reales y el mejor posible"
          onPointerLeave={() => setActive(null)}
        >
          {ticks(domain, 4).map((tick) => (
            <g key={tick}>
              <line className="grid-line" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tickLabel(tick, step)}
              </text>
            </g>
          ))}

          {rows.map((row, i) => {
            const c = centre(i);
            const isActive = active === i;
            const tick = Math.min(slot - 10, bar * 2 + GAP + 16);
            return (
              <g
                key={row.round}
                tabIndex={0}
                role="img"
                aria-label={`Jornada ${row.round}: proyectado ${num(row.projected)}, real ${num(row.real)}${row.best !== null ? `, mejor posible ${num(row.best)}` : ""}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ outline: "none" }}
              >
                <rect x={c - slot / 2} y={MARGIN.top} width={slot} height={height - MARGIN.top - MARGIN.bottom} fill="transparent" />
                <path
                  d={barPath(c - GAP / 2 - bar, bar, zero, y(row.projected))}
                  fill="var(--ink-3)"
                  opacity={isActive ? 1 : 0.8}
                />
                <path d={barPath(c + GAP / 2, bar, zero, y(row.real))} fill={isActive ? "var(--brand-ink)" : "var(--brand)"} />
                {row.best !== null ? (
                  <line
                    x1={c - tick / 2}
                    x2={c + tick / 2}
                    y1={y(row.best)}
                    y2={y(row.best)}
                    stroke="var(--ink)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                ) : null}
                {i === lastIndex ? (
                  <text x={c + GAP / 2 + bar / 2} y={y(row.real) - 7} textAnchor="middle" className="bar-label">
                    {num(row.real, 0)}
                  </text>
                ) : null}
                <text x={c} y={height - MARGIN.bottom + 18} textAnchor="middle">
                  J{row.round}
                </text>
              </g>
            );
          })}

          <line className="axis-line" x1={MARGIN.left} x2={width - MARGIN.right} y1={zero} y2={zero} />
        </svg>

        {active !== null ? (
          <div
            className="tooltip"
            style={{
              left: Math.min(Math.max(centre(active), 90), width - 90),
              top: y(Math.max(rows[active].projected, rows[active].real, rows[active].best ?? 0)),
            }}
          >
            <div className="muted" style={{ marginBottom: 4 }}>
              Jornada {rows[active].round}
            </div>
            <div className="tooltip-row">
              <i className="legend-key" style={{ background: "var(--ink-3)" }} aria-hidden />
              <strong className="num">{num(rows[active].projected)}</strong>
              <span className="muted">proyectado</span>
            </div>
            <div className="tooltip-row">
              <i className="legend-key" style={{ background: "var(--brand)" }} aria-hidden />
              <strong className="num">{num(rows[active].real)}</strong>
              <span className="muted">real</span>
            </div>
            {rows[active].best !== null ? (
              <div className="tooltip-row">
                <i className="legend-key" style={{ background: "var(--ink)" }} aria-hidden />
                <strong className="num">{num(rows[active].best)}</strong>
                <span className="muted">mejor posible</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
