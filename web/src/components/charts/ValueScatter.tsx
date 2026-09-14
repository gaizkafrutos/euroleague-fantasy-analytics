"use client";

/** Precio contra puntos proyectados.
 *
 *  Es el gráfico central del explorador: la diagonal es "lo que el mercado
 *  cobra por rendimiento", y lo que está por encima de ella rinde más de lo que
 *  cuesta. Tres series (base / alero / pívot), que es justo el límite que la
 *  paleta valida para nubes de puntos donde todos los pares coinciden en
 *  pantalla.
 */

import { useMemo, useState } from "react";

import { credits, num, positionLabel } from "@/lib/format";
import type { Player } from "@/lib/types";
import { CHART_MARGIN, extent, linearScale, ticks } from "./scales";

const SERIES: Record<string, string> = {
  G: "var(--series-1)",
  F: "var(--series-2)",
  C: "var(--series-3)",
};

interface Props {
  players: Player[];
  height?: number;
  /** Cuántos chollos etiquetar directamente sobre el gráfico. */
  labelCount?: number;
}

interface Hover {
  player: Player;
  x: number;
  y: number;
}

export default function ValueScatter({ players, height = 380, labelCount = 6 }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);
  const width = 900;

  const points = useMemo(
    () =>
      players.filter(
        (player) =>
          typeof player.price === "number" &&
          player.price > 0 &&
          typeof player.projectedFp === "number",
      ),
    [players],
  );

  const geometry = useMemo(() => {
    const xDomain = extent(points.map((p) => p.price as number));
    const yDomain = extent(points.map((p) => p.projectedFp as number));
    const x = linearScale(xDomain, [CHART_MARGIN.left, width - CHART_MARGIN.right]);
    const y = linearScale(yDomain, [height - CHART_MARGIN.bottom, CHART_MARGIN.top]);
    return { x, y, xDomain, yDomain };
  }, [points, height]);

  /** Recta de referencia: el rendimiento medio que el mercado da por crédito. */
  const reference = useMemo(() => {
    if (points.length < 5) return null;
    const totalPrice = points.reduce((sum, p) => sum + (p.price as number), 0);
    const totalProjection = points.reduce((sum, p) => sum + (p.projectedFp as number), 0);
    const slope = totalProjection / totalPrice;
    const [x0, x1] = geometry.xDomain;
    return { slope, x0, x1 };
  }, [points, geometry]);

  /** Etiquetas directas de los mejores ratios, saltándose las que se pisarían.
   *
   *  Una etiqueta encima de otra no informa de nada; es preferible etiquetar
   *  cinco puntos legibles que ocho ilegibles. Se van colocando por orden de
   *  mérito y se descarta la que solape con alguna ya puesta. */
  const labels = useMemo(() => {
    const ranked = [...points].sort((a, b) => (b.valueProjected ?? 0) - (a.valueProjected ?? 0));
    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const chosen: Array<{ player: Player; x: number; y: number }> = [];

    for (const player of ranked) {
      if (chosen.length >= labelCount) break;
      const text = shortName(player.name);
      const x = geometry.x(player.price as number) + 9;
      const y = geometry.y(player.projectedFp as number) - 7;
      const box = { x, y: y - 11, w: text.length * 6.6, h: 14 };

      const collides = placed.some(
        (other) =>
          box.x < other.x + other.w &&
          box.x + box.w > other.x &&
          box.y < other.y + other.h &&
          box.y + box.h > other.y,
      );
      if (collides) continue;

      placed.push(box);
      chosen.push({ player, x, y });
    }
    return chosen;
  }, [points, labelCount, geometry]);

  if (!points.length) {
    return <p className="muted">Sin datos suficientes para dibujar el mercado.</p>;
  }

  const { x, y } = geometry;

  return (
    <div className="chart-frame">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Dispersión de precio contra puntos fantasy proyectados, por posición"
        onMouseLeave={() => setHover(null)}
      >
        {/* Rejilla */}
        {ticks(geometry.yDomain, 5).map((tick) => (
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
        {ticks(geometry.xDomain, 6).map((tick) => (
          <text key={`x-${tick}`} x={x(tick)} y={height - CHART_MARGIN.bottom + 16} textAnchor="middle">
            {num(tick, 0)}
          </text>
        ))}

        <line
          className="axis-line"
          x1={CHART_MARGIN.left}
          x2={width - CHART_MARGIN.right}
          y1={height - CHART_MARGIN.bottom}
          y2={height - CHART_MARGIN.bottom}
        />

        {/* Precio justo según el mercado */}
        {reference ? (
          <>
            <line
              x1={x(reference.x0)}
              x2={x(reference.x1)}
              y1={y(reference.slope * reference.x0)}
              y2={y(reference.slope * reference.x1)}
              stroke="var(--axis)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={x(reference.x1) - 6}
              y={y(reference.slope * reference.x1) - 8}
              textAnchor="end"
            >
              precio justo del mercado
            </text>
          </>
        ) : null}

        {/* Marcas */}
        {points.map((player) => {
          const cx = x(player.price as number);
          const cy = y(player.projectedFp as number);
          const active = hover?.player.id === player.id;
          return (
            <circle
              key={player.id}
              className="mark"
              cx={cx}
              cy={cy}
              r={active ? 7 : 5}
              fill={SERIES[player.position ?? "G"]}
              onMouseEnter={() => setHover({ player, x: cx, y: cy })}
              onFocus={() => setHover({ player, x: cx, y: cy })}
              tabIndex={-1}
            >
              <title>{`${player.name} · ${credits(player.price)} · ${num(player.projectedFp)} pts proyectados`}</title>
            </circle>
          );
        })}

        {/* Etiquetas directas de los mejores ratios */}
        {labels.map(({ player, x: lx, y: ly }) => (
          <text
            key={`label-${player.id}`}
            x={lx}
            y={ly}
            fill="var(--ink-2)"
            style={{ fontWeight: 600, paintOrder: "stroke" }}
            stroke="var(--surface)"
            strokeWidth={3}
            strokeLinejoin="round"
          >
            {shortName(player.name)}
          </text>
        ))}

        <text
          x={width - CHART_MARGIN.right}
          y={height - 4}
          textAnchor="end"
          fill="var(--ink-muted)"
        >
          precio (créditos) →
        </text>
      </svg>

      {hover ? (
        <div
          className="tooltip"
          style={{ left: `${(hover.x / width) * 100}%`, top: `${(hover.y / height) * 100}%` }}
        >
          <div className="tooltip-title">{hover.player.name}</div>
          <div className="muted">
            {positionLabel(hover.player.position)} · {hover.player.clubShort ?? hover.player.club}
          </div>
          <div className="num">
            {credits(hover.player.price)} · {num(hover.player.projectedFp)} pts proy.
          </div>
          <div className="num muted">
            {num(hover.player.valueProjected, 2)} pts por crédito
          </div>
        </div>
      ) : null}

      <div className="chart-legend" style={{ marginTop: 10 }}>
        {(["G", "F", "C"] as const).map((position) => (
          <span key={position}>
            <i className="legend-swatch" style={{ background: SERIES[position] }} />
            {positionLabel(position)}
          </span>
        ))}
        <span className="muted">Por encima de la línea: rinde más de lo que cuesta.</span>
      </div>
    </div>
  );
}

function shortName(name: string): string {
  const clean = name.includes(",") ? name.split(",")[0] : name.split(" ").slice(-1)[0];
  const trimmed = clean.trim();
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}
