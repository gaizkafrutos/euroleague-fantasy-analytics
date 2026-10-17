"use client";

/** Sesgo por jornada: columnas que salen del cero, hacia arriba si la web
 *  proyectó de más y hacia abajo si se quedó corta.
 *
 *  Una sola serie (sin leyenda; el título la nombra). Se escribe la cifra de
 *  la última jornada y la de la mayor desviación; el resto, en el tooltip y en
 *  la tabla de debajo.
 */
import { useState } from "react";

import { signed } from "@/lib/format";
import { barPath, linearScale, tickLabel, tickStep, ticks } from "./scales";
import { useChartWidth } from "./useChartWidth";

interface Props {
  rounds: number[];
  values: number[];
  height?: number;
}

const MARGIN = { top: 22, right: 12, bottom: 30, left: 40 };

export default function RoundBias({ rounds, values, height = 220 }: Props) {
  const [frameRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const reach = Math.max(0.5, ...values.map((v) => Math.abs(v))) * 1.2;
  const domain: [number, number] = [Math.min(0, ...values) < 0 ? -reach : -reach * 0.25, reach];
  const step = tickStep(domain, 4);
  const y = linearScale(domain, [height - MARGIN.bottom, MARGIN.top]);
  const slot = (width - MARGIN.left - MARGIN.right) / Math.max(values.length, 1);
  const bar = Math.min(24, slot - 6);
  const zero = y(0);
  const extreme = values.reduce((best, v, i) => (Math.abs(v) > Math.abs(values[best]) ? i : best), 0);
  const centre = (i: number) => MARGIN.left + slot * (i + 0.5);

  return (
    <div ref={frameRef} className="chart-frame">
      <svg
        className="chart is-px"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Sesgo de la proyección publicada por jornada, en puntos"
        onPointerLeave={() => setActive(null)}
      >
        {ticks(domain, 4).map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
            <text x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {tick > 0 ? "+" : ""}
              {tickLabel(tick, step)}
            </text>
          </g>
        ))}
        <text x={MARGIN.left} y={MARGIN.top - 10}>
          ↑ proyectó de más
        </text>

        {values.map((v, i) => {
          const isActive = active === i;
          const labelled = i === values.length - 1 || i === extreme;
          return (
            <g
              key={rounds[i]}
              tabIndex={0}
              role="img"
              aria-label={`Jornada ${rounds[i]}: sesgo ${signed(v, 2)} puntos`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              style={{ outline: "none" }}
            >
              {/* Zona sensible: toda la columna, no solo la barra. */}
              <rect x={centre(i) - slot / 2} y={MARGIN.top} width={slot} height={height - MARGIN.top - MARGIN.bottom} fill="transparent" />
              <path
                d={barPath(centre(i) - bar / 2, bar, zero, y(v))}
                fill={isActive ? "var(--brand-ink)" : "var(--brand)"}
              />
              {labelled ? (
                <text
                  x={centre(i)}
                  y={v >= 0 ? y(v) - 7 : y(v) + 15}
                  textAnchor="middle"
                  className="bar-label"
                >
                  {signed(v, 2)}
                </text>
              ) : null}
              <text x={centre(i)} y={height - MARGIN.bottom + 18} textAnchor="middle">
                J{rounds[i]}
              </text>
            </g>
          );
        })}

        <line className="axis-line" x1={MARGIN.left} x2={width - MARGIN.right} y1={zero} y2={zero} />
      </svg>

      {active !== null ? (
        <div className="tooltip" style={{ left: Math.min(Math.max(centre(active), 70), width - 70), top: y(Math.max(values[active], 0)) }}>
          <div className="tooltip-title num">{signed(values[active], 2)} puntos</div>
          <div className="muted">Jornada {rounds[active]}, por jugador</div>
        </div>
      ) : null}
    </div>
  );
}
