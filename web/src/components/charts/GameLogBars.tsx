"use client";

/** Puntuación fantasy partido a partido.
 *
 *  Barras finas ancladas al cero, con las puntas redondeadas y 2px de hueco
 *  entre ellas. La media y el suelo (percentil 25) van como reglas de
 *  referencia: es lo que convierte una lista de números en una lectura de
 *  riesgo — un jugador que nunca baja de 12 vale más que uno que promedia lo
 *  mismo alternando 4 y 26.
 */
import { useState } from "react";

import { num } from "@/lib/format";
import type { GameLine } from "@/lib/types";
import { CHART_MARGIN, linearScale, ticks } from "./scales";

interface Props {
  games: GameLine[];
  average?: number | null;
  floor?: number | null;
  height?: number;
}

export default function GameLogBars({ games, average, floor, height = 220 }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const width = 720;

  if (!games.length) {
    return <p className="muted" style={{ margin: 0 }}>Sin partidos registrados todavía.</p>;
  }

  const values = games.map((game) => game.fp);
  const max = Math.max(...values, average ?? 0, 1);
  const min = Math.min(...values, 0);
  const y = linearScale([min, max * 1.08], [height - CHART_MARGIN.bottom, CHART_MARGIN.top]);

  const slot = (width - CHART_MARGIN.left - CHART_MARGIN.right) / games.length;
  const barWidth = Math.max(Math.min(slot - 4, 26), 6);
  const zero = y(0);

  return (
    <div className="chart-frame">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Puntos fantasy por partido"
        onMouseLeave={() => setActive(null)}
      >
        {ticks([min, max * 1.08], 4).map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="grid-line"
              x1={CHART_MARGIN.left}
              x2={width - CHART_MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text x={CHART_MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {num(tick, 0)}
            </text>
          </g>
        ))}

        {average != null ? (
          <>
            <line
              x1={CHART_MARGIN.left}
              x2={width - CHART_MARGIN.right}
              y1={y(average)}
              y2={y(average)}
              stroke="var(--axis)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={width - CHART_MARGIN.right} y={y(average) - 6} textAnchor="end">
              media {num(average)}
            </text>
          </>
        ) : null}

        {floor != null ? (
          <line
            x1={CHART_MARGIN.left}
            x2={width - CHART_MARGIN.right}
            y1={y(floor)}
            y2={y(floor)}
            stroke="var(--grid)"
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
        ) : null}

        {games.map((game, index) => {
          const centre = CHART_MARGIN.left + slot * (index + 0.5);
          const top = game.fp >= 0 ? y(game.fp) : zero;
          const barHeight = Math.abs(zero - y(game.fp));
          const isActive = active === index;
          return (
            <g key={`${game.round}-${index}`}>
              <rect
                x={centre - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(barHeight, 1.5)}
                rx={3}
                fill={game.played ? (isActive ? "var(--accent)" : "var(--series-1)") : "var(--surface-3)"}
                onMouseEnter={() => setActive(index)}
              />
              {games.length <= 16 ? (
                <text x={centre} y={height - CHART_MARGIN.bottom + 15} textAnchor="middle">
                  {game.round ?? "—"}
                </text>
              ) : null}
            </g>
          );
        })}

        <line
          className="axis-line"
          x1={CHART_MARGIN.left}
          x2={width - CHART_MARGIN.right}
          y1={zero}
          y2={zero}
        />
        <text x={CHART_MARGIN.left} y={height - 3} textAnchor="start" fill="var(--ink-muted)">
          jornada
        </text>
      </svg>

      {active !== null ? (
        <div
          className="tooltip"
          style={{
            left: `${((CHART_MARGIN.left + slot * (active + 0.5)) / width) * 100}%`,
            top: `${(y(Math.max(games[active].fp, 0)) / height) * 100}%`,
          }}
        >
          <div className="tooltip-title num">{num(games[active].fp)} pts</div>
          <div className="muted">
            J{games[active].round ?? "—"} · {games[active].home ? "vs" : "@"}{" "}
            {games[active].opponent ?? "—"}
          </div>
          <div className="muted num">{num(games[active].minutes)} min</div>
        </div>
      ) : null}
    </div>
  );
}
