"use client";

/** Una métrica jornada a jornada para dos o tres series (HoopIQ frente a la
 *  media simple, por ejemplo), con crosshair y tooltip.
 *
 *  La serie protagonista va en el naranja de la marca y las de contraste en
 *  gris: el gráfico cuenta una cosa, no compara marcas. Leyenda siempre (hay
 *  más de una serie) y la última cifra de cada línea escrita al final, salvo
 *  que choquen: entonces solo la protagonista.
 */
import { useState, type KeyboardEvent } from "react";

import { num } from "@/lib/format";
import { extent, linePath, linearScale, tickLabel, tickStep, ticks } from "./scales";
import { useChartWidth } from "./useChartWidth";

export interface RoundSeries {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

interface Props {
  rounds: number[];
  series: RoundSeries[];
  ariaLabel: string;
  digits?: number;
  height?: number;
}

const MARGIN = { top: 16, right: 52, bottom: 30, left: 40 };

export default function RoundLines({ rounds, series, ariaLabel, digits = 2, height = 220 }: Props) {
  const [frameRef, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const yDomain = extent(all, 0.18);
  const yStep = tickStep(yDomain, 4);
  const x = linearScale([0, Math.max(rounds.length - 1, 1)], [MARGIN.left + 12, width - MARGIN.right]);
  const y = linearScale(yDomain, [height - MARGIN.bottom, MARGIN.top]);
  const last = rounds.length - 1;

  // Etiquetas finales: si las dos últimas cifras quedan a menos de 14 px, solo
  // se escribe la de la serie protagonista (la primera).
  const ends = series.map((s) => s.values[last]);
  const crowded =
    ends.length > 1 &&
    ends.some((a, i) => ends.some((b, j) => i !== j && a !== null && b !== null && Math.abs(y(a) - y(b)) < 14));

  function nearest(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * width;
    const index = Math.round(x.invert(px));
    setActive(Math.max(0, Math.min(last, index)));
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? -1) + 1));
    else if (event.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last + 1) - 1));
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        {series.map((s) => (
          <span key={s.key}>
            <i className="legend-key" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div
        ref={frameRef}
        className="chart-frame"
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        aria-label={`${ariaLabel}. Flechas para recorrer las jornadas.`}
      >
        <svg
          className="chart is-px"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={(event) => nearest(event.clientX, event.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
        >
          {ticks(yDomain, 4).map((tick) => (
            <g key={tick}>
              <line className="grid-line" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tickLabel(tick, yStep)}
              </text>
            </g>
          ))}

          {rounds.map((round, index) => (
            <text key={round} x={x(index)} y={height - MARGIN.bottom + 18} textAnchor="middle">
              J{round}
            </text>
          ))}

          {active !== null ? (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={MARGIN.top}
              y2={height - MARGIN.bottom}
              stroke="var(--rule)"
              strokeWidth={1}
            />
          ) : null}

          {/* De atrás adelante: la protagonista, encima. */}
          {[...series].reverse().map((s) => {
            const points = s.values
              .map((v, i): [number, number] | null => (v === null ? null : [x(i), y(v)]))
              .filter((p): p is [number, number] => p !== null);
            return (
              <g key={s.key}>
                <path className="series-line" d={linePath(points)} stroke={s.color} />
                {s.values.map((v, i) =>
                  v === null ? null : (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={active === i ? 5.5 : 4}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  ),
                )}
              </g>
            );
          })}

          {series.map((s, i) => {
            const v = s.values[last];
            if (v === null || (crowded && i > 0)) return null;
            return (
              <text key={s.key} x={x(last) + 10} y={y(v)} dominantBaseline="middle" className="bar-label">
                {num(v, digits)}
              </text>
            );
          })}

          <line
            className="axis-line"
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={height - MARGIN.bottom}
            y2={height - MARGIN.bottom}
          />
        </svg>

        {active !== null ? (
          <div
            className="tooltip"
            style={{
              left: Math.min(Math.max(x(active), 70), width - 70),
              top: y(Math.max(...series.map((s) => s.values[active] ?? -Infinity))),
            }}
          >
            <div className="muted" style={{ marginBottom: 4 }}>
              Jornada {rounds[active]}
            </div>
            {series.map((s) => (
              <div key={s.key} className="tooltip-row">
                <i className="legend-key" style={{ background: s.color }} aria-hidden />
                <strong className="num">{num(s.values[active], digits)}</strong>
                <span className="muted">{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
