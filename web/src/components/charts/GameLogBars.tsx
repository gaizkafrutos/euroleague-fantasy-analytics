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
import { CHART_MARGIN, linearScale, tickLabel, tickStep, ticks } from "./scales";
import { useFitWidth } from "./useFitWidth";

interface Props {
  games: GameLine[];
  average?: number | null;
  floor?: number | null;
  height?: number;
}

export default function GameLogBars({ games, average, floor, height = 220 }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const [frame, measured] = useFitWidth();
  const width = measured ?? 720;

  if (!games.length) {
    return <p className="muted" style={{ margin: 0 }}>Sin partidos registrados todavía.</p>;
  }

  /* Con uno o dos partidos no hay serie que dibujar: una barra suelta sobre un
     eje de 0 a 30 parece un error. Se enseñan las cifras. */
  if (games.length < 3) {
    return (
      <ul className="game-figures">
        {games.map((game, index) => (
          <li key={`${game.round}-${index}`}>
            <span className="single-reading-value num">{game.played ? num(game.fp) : "—"}</span>
            <span className="muted num">
              {game.played ? "pts" : "No jugó"} · J{game.round ?? "—"} · {game.home ? "vs" : "@"}{" "}
              {game.opponent ?? "—"}
              {game.played ? ` · ${num(game.minutes)} min` : ""}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const values = games.map((game) => game.fp);
  const max = Math.max(...values, average ?? 0, 1);
  const min = Math.min(...values, 0);
  const y = linearScale([min, max * 1.08], [height - CHART_MARGIN.bottom, CHART_MARGIN.top]);

  const slot = (width - CHART_MARGIN.left - CHART_MARGIN.right) / games.length;
  const barWidth = Math.max(Math.min(slot - 4, 26), 6);
  const zero = y(0);
  const best = Math.max(...values);
  // Con sitio, el rival debajo de la jornada: la barra sin contexto no dice
  // contra quién fue el 41,8.
  const showRival = slot >= 44 && games.length <= 16;
  const svgHeight = height + (showRival ? 16 : 0);

  return (
    <div className="chart-frame" ref={frame}>
      <svg
        className={`chart${measured ? " is-fit" : ""}`}
        viewBox={`0 0 ${width} ${svgHeight}`}
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
              {tickLabel(tick, tickStep([min, max * 1.08], 4))}
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
          </>
        ) : null}

        {floor != null ? (
          <line
            x1={CHART_MARGIN.left}
            x2={width - CHART_MARGIN.right}
            y1={y(floor)}
            y2={y(floor)}
            stroke="var(--ink-3)"
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
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
                fill={game.played ? (isActive ? "var(--brand-ink)" : "var(--brand)") : "var(--line)"}
                onMouseEnter={() => setActive(index)}
              />
              {index === games.length - 1 || game.fp === best ? (
                <text
                  x={centre}
                  y={top - 6}
                  textAnchor="middle"
                  className="bar-label"
                >
                  {num(game.fp)}
                </text>
              ) : null}
              {games.length <= 16 ? (
                <text x={centre} y={height - CHART_MARGIN.bottom + 15} textAnchor="middle">
                  {game.round ?? "—"}
                </text>
              ) : null}
              {showRival ? (
                <text
                  x={centre}
                  y={height - CHART_MARGIN.bottom + 31}
                  textAnchor="middle"
                  className="axis-sub"
                >
                  {game.home ? "vs" : "@"} {game.opponent ?? "—"}
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
        <text x={CHART_MARGIN.left - 8} y={height - CHART_MARGIN.bottom + 15} textAnchor="end" fill="var(--ink-muted)">
          J
        </text>
      </svg>

      {/* Las referencias se nombran fuera: dentro, cualquier barra alta
          tapaba la etiqueta. */}
      {average != null || floor != null ? (
        <div className="chart-legend chart-refs">
          {average != null ? (
            <span>
              <i className="legend-line" aria-hidden /> media {num(average)}
            </span>
          ) : null}
          {floor != null ? (
            <span>
              <i className="legend-line is-dotted" aria-hidden /> suelo {num(floor)}
            </span>
          ) : null}
        </div>
      ) : null}

      {active !== null ? (
        <div
          className="tooltip"
          style={{
            left: `${((CHART_MARGIN.left + slot * (active + 0.5)) / width) * 100}%`,
            top: `${(y(Math.max(games[active].fp, 0)) / svgHeight) * 100}%`,
          }}
        >
          <div className="tooltip-title num">
            {games[active].played ? `${num(games[active].fp)} pts` : "No jugó"}
          </div>
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
