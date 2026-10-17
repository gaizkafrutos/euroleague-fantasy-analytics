"use client";

/** Probabilidad de jugar: lo que dijo la web frente a lo que pasó, por estado
 *  del parte de lesiones.
 *
 *  Una fila por estado sobre un eje de 0 a 100 %: el círculo hueco es lo que
 *  se publicó, el lleno lo que de verdad jugaron, y la línea que los une es el
 *  error. Si los dos caen encima, la probabilidad estaba bien calibrada.
 */
import { useState } from "react";

import { num, percent } from "@/lib/format";
import { linearScale } from "./scales";
import { useChartWidth } from "./useChartWidth";

export interface CalibrationRow {
  key: string;
  label: string;
  n: number;
  predicted: number | null;
  real: number;
}

const ROW = 40;
const MARGIN = { top: 8, right: 18, bottom: 30, left: 132 };

export default function PlayCalibration({ rows }: { rows: CalibrationRow[] }) {
  const [frameRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;
  const x = linearScale([0, 1], [MARGIN.left, width - MARGIN.right]);
  const rowY = (i: number) => MARGIN.top + ROW * (i + 0.5);

  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        <span>
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="var(--surface)" stroke="var(--ink-3)" strokeWidth="2" />
          </svg>
          Lo que dijo la web
        </span>
        <span>
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill="var(--brand)" />
          </svg>
          Los que jugaron
        </span>
      </div>
      <div ref={frameRef} className="chart-frame">
        <svg
          className="chart is-px"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Probabilidad de jugar publicada frente a la real, por estado del parte"
          onPointerLeave={() => setActive(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <g key={tick}>
              <line className="grid-line" x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={height - MARGIN.bottom} />
              <text x={x(tick)} y={height - MARGIN.bottom + 18} textAnchor="middle">
                {percent(tick)}
              </text>
            </g>
          ))}

          {rows.map((row, i) => {
            const cy = rowY(i);
            const said = row.predicted;
            return (
              <g
                key={row.key}
                tabIndex={0}
                role="img"
                aria-label={`${row.label}: la web dijo ${percent(said)}, jugaron ${percent(row.real)} de ${row.n}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ outline: "none" }}
              >
                <rect x={0} y={cy - ROW / 2} width={width} height={ROW} fill={active === i ? "var(--surface-hover)" : "transparent"} />
                <text x={0} y={cy - 2} className="bar-label" style={{ fontFamily: "var(--font)" }}>
                  {row.label}
                </text>
                <text x={0} y={cy + 13}>
                  {num(row.n, 0)} casos
                </text>
                {said !== null ? (
                  <line x1={x(said)} x2={x(row.real)} y1={cy} y2={cy} stroke="var(--axis)" strokeWidth={2} strokeLinecap="round" />
                ) : null}
                {said !== null ? (
                  <circle cx={x(said)} cy={cy} r={5} fill="var(--surface)" stroke="var(--ink-3)" strokeWidth={2} />
                ) : null}
                <circle cx={x(row.real)} cy={cy} r={5.5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            );
          })}
        </svg>

        {active !== null ? (
          <div
            className="tooltip"
            style={{ left: Math.min(Math.max(x(rows[active].real), 90), width - 90), top: rowY(active) - 6 }}
          >
            <div className="tooltip-title">{rows[active].label}</div>
            <div className="tooltip-row">
              <strong className="num">{percent(rows[active].predicted)}</strong>
              <span className="muted">dijo la web</span>
            </div>
            <div className="tooltip-row">
              <strong className="num">{percent(rows[active].real)}</strong>
              <span className="muted">jugaron ({num(rows[active].n, 0)} casos)</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
