"use client";

/** Precio contra puntos proyectados.
 *
 *  Es el gráfico central del explorador: la diagonal es "lo que el mercado
 *  cobra por rendimiento", y lo que está por encima de ella rinde más de lo que
 *  cuesta.
 *
 *  La posición no lleva color propio: todo el mercado va en gris y la que se
 *  elige en la leyenda se resalta en el color de marca (énfasis, no tres
 *  series). Así el naranja sigue siendo el único color del sitio.
 */

import { useMemo, useState } from "react";

import { breakEvenAt } from "@/lib/advanced";
import { credits, displayName, num, positionLabel, signed } from "@/lib/format";
import type { Player } from "@/lib/types";
import { CHART_MARGIN, extent, linearScale, tickLabel, tickStep, ticks } from "./scales";
import { useFitWidth } from "./useFitWidth";

/* Más margen abajo: la etiqueta del eje X va bajo las cifras, no encima. */
const MARGIN = { ...CHART_MARGIN, bottom: 46 };

type Position = "G" | "F" | "C";

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

export default function ValueScatter({ players, height: baseHeight = 380, labelCount: baseLabels = 6 }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [highlight, setHighlight] = useState<Position | null>(null);
  const [frame, measured] = useFitWidth();
  const width = measured ?? 900;
  // En el móvil la nube se hace casi cuadrada: a 343 × 144 los 336 puntos se
  // amontonaban en una franja. Menos etiquetas y puntos algo más pequeños.
  const narrow = width < 560;
  const height = narrow ? Math.max(300, Math.round(width * 0.92)) : baseHeight;
  const labelCount = narrow ? Math.min(baseLabels, 4) : baseLabels;
  const radius = narrow ? 4 : 5;

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
    const x = linearScale(xDomain, [MARGIN.left, width - MARGIN.right]);
    const y = linearScale(yDomain, [height - MARGIN.bottom, MARGIN.top]);
    return { x, y, xDomain, yDomain };
  }, [points, height, width]);

  /** Recta de referencia: el umbral de revalorización. Es la que el juego usa
   *  de verdad para mover precios (plus = a·puntos + b·precio + c), así que por
   *  encima de ella un jugador sube si rinde lo que proyecta, y por debajo baja.
   *  Sustituye a la "media del mercado", que no movía ningún precio. */
  const reference = useMemo(() => {
    if (points.length < 5) return null;
    const [x0, x1] = geometry.xDomain;
    const y0 = breakEvenAt(x0);
    const y1 = breakEvenAt(x1);
    if (y0 === null || y1 === null) return null;
    return { x0, x1, y0, y1 };
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
      const text = shortName(player);
      const x = geometry.x(player.price as number) + 9;
      const y = geometry.y(player.projectedFp as number) - 7;
      // Caja aproximada de la etiqueta a 11 unidades de cuerpo, con un margen.
      const box = { x: x - 2, y: y - 12, w: text.length * 7.4 + 4, h: 16 };

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

  const ordered = useMemo(
    () =>
      highlight === null
        ? points
        : [...points].sort(
            (a, b) => Number(a.position === highlight) - Number(b.position === highlight),
          ),
    [points, highlight],
  );

  if (!points.length) {
    return <p className="muted">Sin datos suficientes para dibujar el mercado.</p>;
  }

  const { x, y } = geometry;

  return (
    <div className="chart-frame" ref={frame}>
      <svg
        className={`chart${measured ? " is-fit" : " is-wide"}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Dispersión de precio contra puntos fantasy proyectados, por posición"
        onMouseLeave={() => setHover(null)}
      >
        {/* Rejilla */}
        {ticks(geometry.yDomain, 4).map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="grid-line"
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {tickLabel(tick, tickStep(geometry.yDomain, 4))}
            </text>
          </g>
        ))}
        {ticks(geometry.xDomain, narrow ? 4 : 6).map((tick) => (
          <text key={`x-${tick}`} x={x(tick)} y={height - MARGIN.bottom + 20} textAnchor="middle">
            {tickLabel(tick, tickStep(geometry.xDomain, narrow ? 4 : 6))}
          </text>
        ))}

        <line
          className="axis-line"
          x1={MARGIN.left}
          x2={width - MARGIN.right}
          y1={height - MARGIN.bottom}
          y2={height - MARGIN.bottom}
        />

        {/* Umbral de revalorización */}
        {reference ? (
          <>
            <line
              x1={x(reference.x0)}
              x2={x(reference.x1)}
              y1={y(reference.y0)}
              y2={y(reference.y1)}
              stroke="var(--ink-2)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text x={x(reference.x0) + 6} y={MARGIN.top + 10} className="chart-halo">
              ↑ se revaloriza
            </text>
          </>
        ) : null}

        {/* Marcas: las resaltadas se pintan al final, por encima del resto. */}
        {ordered.map((player) => {
          const cx = x(player.price as number);
          const cy = y(player.projectedFp as number);
          const active = hover?.player.id === player.id;
          const lit = highlight !== null && player.position === highlight;
          return (
            <circle
              key={player.id}
              className="mark"
              cx={cx}
              cy={cy}
              r={active ? radius + 2 : radius}
              fill={lit ? "var(--brand)" : "var(--ink-3)"}
              fillOpacity={lit || highlight === null ? 1 : 0.35}
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
            {shortName(player)}
          </text>
        ))}

        <text
          x={width - CHART_MARGIN.right}
          y={height - 2}
          textAnchor="end"
          fill="var(--ink-muted)"
        >
          precio (créditos) →
        </text>
        <text
          x={-(MARGIN.top + (height - MARGIN.top - MARGIN.bottom) / 2)}
          y={11}
          transform="rotate(-90)"
          textAnchor="middle"
          fill="var(--ink-muted)"
        >
          pts proyectados
        </text>
      </svg>

      {hover ? (
        <div
          className="tooltip"
          style={{ left: `${(hover.x / width) * 100}%`, top: `${(hover.y / height) * 100}%` }}
        >
          <div className="tooltip-title">{displayName(hover.player)}</div>
          <div className="muted">
            {positionLabel(hover.player.position)} · {hover.player.clubShort ?? hover.player.club}
          </div>
          <div className="num">
            {credits(hover.player.price)} · {num(hover.player.projectedFp)} pts previstos
          </div>
          <div className="num muted">
            {num(hover.player.valueProjected, 2)} pts por crédito
          </div>
          {hover.player.outlook ? (
            <div className="num muted">
              necesita {num(hover.player.outlook.breakEven)} · precio{" "}
              {signed(hover.player.outlook.expectedChange)} cr
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="chart-legend" style={{ marginTop: 10 }}>
        {/* Resalta sin quitar a nadie: filtrar ya se filtra en Filtros. */}
        <span className="muted">Resaltar</span>
        <span className="segmented" role="group" aria-label="Resaltar una posición">
          {([null, "G", "F", "C"] as const).map((position) => (
            <button
              key={position ?? "all"}
              type="button"
              aria-pressed={highlight === position}
              onClick={() => setHighlight(position)}
            >
              {position ? (position === "G" ? "Bases" : position === "F" ? "Aleros" : "Pívots") : "Todas"}
            </button>
          ))}
        </span>
        <span className="muted">
          <i className="legend-line" aria-hidden /> Por encima de la línea, sube de precio si rinde
          lo proyectado.
        </span>
      </div>
    </div>
  );
}

/** Solo el apellido: en la nube de puntos no cabe más.
 *
 *  Toma el jugador y no el nombre porque los que no cruzan con el censo lo
 *  tienen a null y solo traen el del mercado. */
function shortName(player: Player): string {
  const raw = player.name ?? player.marketName ?? "";
  const clean = raw.includes(",") ? raw.split(",")[0] : raw.split(" ").slice(-1)[0];
  const trimmed = (clean ?? "").trim();
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}
