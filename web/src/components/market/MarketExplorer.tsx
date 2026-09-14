"use client";

/** Explorador de mercado: filtros, nube de valor y tabla ordenable.
 *
 *  Los 350 jugadores se filtran en cliente. No hace falta paginar ni pedir nada
 *  al servidor: el dataset completo pesa menos que una foto de jugador.
 */
import { useDeferredValue, useMemo, useState } from "react";

import Sparkline from "@/components/charts/Sparkline";
import ValueScatter from "@/components/charts/ValueScatter";
import { Delta, PlayerCell, PositionBadge } from "@/components/ui/primitives";
import { credits, num, percent } from "@/lib/format";
import type { Player, Team } from "@/lib/types";

type SortKey =
  | "bargainScore"
  | "price"
  | "projectedFp"
  | "valueProjected"
  | "fpAvg"
  | "form"
  | "minutesAvg"
  | "consistency"
  | "priceDeltaLast"
  | "difficulty";

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  { key: "price", label: "Precio", title: "Precio actual en créditos" },
  { key: "priceDeltaLast", label: "Δ precio", title: "Variación desde el snapshot anterior" },
  { key: "projectedFp", label: "Proyección", title: "Puntos fantasy esperados la próxima jornada" },
  { key: "valueProjected", label: "Pts/cr", title: "Puntos proyectados por crédito" },
  { key: "fpAvg", label: "Media", title: "Media de puntos fantasy por partido jugado" },
  { key: "form", label: "Forma", title: "Media de los últimos 5 partidos" },
  { key: "minutesAvg", label: "Min", title: "Minutos por partido y su tendencia" },
  { key: "consistency", label: "Fiabilidad", title: "1 = regular, 0 = lotería" },
  { key: "difficulty", label: "Calendario", title: "Dificultad de los 3 próximos rivales (100 = lo más duro)" },
  { key: "bargainScore", label: "Índice", title: "Índice compuesto de chollo" },
];

interface Props {
  players: Player[];
  teams: Team[];
  details: Record<string, { recent: Array<{ fp: number }> }>;
  hasPrices: boolean;
}

export default function MarketExplorer({ players, teams, details, hasPrices }: Props) {
  const [query, setQuery] = useState("");
  const [positions, setPositions] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState("");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minGames, setMinGames] = useState(0);
  const [risingOnly, setRisingOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: hasPrices ? "bargainScore" : "fpAvg",
    desc: true,
  });
  const [view, setView] = useState<"tabla" | "grafico">("tabla");

  const deferredQuery = useDeferredValue(query);

  const priceCeiling = useMemo(() => {
    const prices = players.map((p) => p.price ?? 0).filter((value) => value > 0);
    return prices.length ? Math.ceil(Math.max(...prices)) : 30;
  }, [players]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return players.filter((player) => {
      if (needle && !`${player.name} ${player.clubName ?? ""}`.toLowerCase().includes(needle)) return false;
      if (positions.size && (!player.position || !positions.has(player.position))) return false;
      if (team && player.club !== team) return false;
      if (maxPrice !== null && (player.price ?? 0) > maxPrice) return false;
      if (minGames && (player.perf.gamesPlayed ?? 0) < minGames) return false;
      if (risingOnly && (player.perf.minutesShareTrend ?? 0) <= 0) return false;
      return true;
    });
  }, [players, deferredQuery, positions, team, maxPrice, minGames, risingOnly]);

  const sorted = useMemo(() => {
    const value = (player: Player, key: SortKey): number | null => {
      switch (key) {
        case "price":
          return player.price;
        case "priceDeltaLast":
          return player.priceDeltaLast;
        case "projectedFp":
          return player.projectedFp;
        case "valueProjected":
          return player.valueProjected ?? player.valuePerCredit;
        case "fpAvg":
          return player.perf.fpAvg;
        case "form":
          return player.perf.form;
        case "minutesAvg":
          return player.perf.minutesAvg;
        case "consistency":
          return player.perf.consistency;
        case "difficulty":
          return player.schedule.difficulty;
        case "bargainScore":
          return player.bargainScore;
      }
    };

    return [...filtered].sort((a, b) => {
      const left = value(a, sort.key);
      const right = value(b, sort.key);
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return sort.desc ? right - left : left - right;
    });
  }, [filtered, sort]);

  function togglePosition(position: string) {
    setPositions((previous) => {
      const next = new Set(previous);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  function applySort(key: SortKey) {
    setSort((previous) =>
      previous.key === key ? { key, desc: !previous.desc } : { key, desc: true },
    );
  }

  return (
    <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
      {/* ---------------------------------------------------------- filtros */}
      <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
        <label className="control" style={{ flex: "1 1 220px" }}>
          <span className="control-label">Buscar</span>
          <input
            className="input"
            type="search"
            placeholder="Jugador o equipo"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="control">
          <span className="control-label">Posición</span>
          <div className="row" style={{ gap: 6 }}>
            {(["G", "F", "C"] as const).map((position) => (
              <button
                key={position}
                type="button"
                className="chip"
                aria-pressed={positions.has(position)}
                onClick={() => togglePosition(position)}
              >
                {position === "G" ? "Bases" : position === "F" ? "Aleros" : "Pívots"}
              </button>
            ))}
          </div>
        </div>

        <label className="control">
          <span className="control-label">Equipo</span>
          <select className="select" value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">Todos</option>
            {teams.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.short ?? entry.name}
              </option>
            ))}
          </select>
        </label>

        {hasPrices ? (
          <label className="control" style={{ flex: "0 1 190px" }}>
            <span className="control-label">
              Precio máximo {maxPrice !== null ? `· ${maxPrice} cr` : ""}
            </span>
            <input
              className="slider"
              type="range"
              min={1}
              max={priceCeiling}
              step={0.5}
              value={maxPrice ?? priceCeiling}
              onChange={(event) => setMaxPrice(Number(event.target.value))}
            />
          </label>
        ) : null}

        <label className="control">
          <span className="control-label">Mín. partidos</span>
          <select
            className="select"
            value={minGames}
            onChange={(event) => setMinGames(Number(event.target.value))}
          >
            {[0, 3, 5, 10, 20].map((value) => (
              <option key={value} value={value}>
                {value === 0 ? "Sin mínimo" : `${value}+`}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="chip"
          aria-pressed={risingOnly}
          onClick={() => setRisingOnly((value) => !value)}
          title="Solo jugadores que están ganando peso en la rotación de su equipo"
        >
          Rol al alza
        </button>

        <div className="segmented" style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={view === "tabla"} onClick={() => setView("tabla")}>
            Tabla
          </button>
          <button type="button" aria-pressed={view === "grafico"} onClick={() => setView("grafico")}>
            Nube
          </button>
        </div>
      </div>

      <p className="card-note" style={{ margin: 0 }}>
        {sorted.length} de {players.length} jugadores
        {positions.size || team || query || minGames || risingOnly ? " tras los filtros" : ""}.
      </p>

      {/* ------------------------------------------------------------ vista */}
      {view === "grafico" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Precio contra rendimiento esperado</div>
              <p className="card-note" style={{ margin: "4px 0 0" }}>
                Cada punto es un jugador. La diagonal marca lo que el mercado cobra de media
                por punto: quien está por encima rinde más de lo que cuesta.
              </p>
            </div>
          </div>
          <ValueScatter players={sorted} />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Jugador</th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="num"
                    title={column.title}
                    aria-sort={
                      sort.key === column.key ? (sort.desc ? "descending" : "ascending") : undefined
                    }
                    onClick={() => applySort(column.key)}
                  >
                    {column.label}
                    {sort.key === column.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th scope="col" className="hide-sm">
                  Últimos
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 120).map((player) => (
                <tr key={player.id}>
                  <td>
                    <PlayerCell player={player} />
                  </td>
                  <td className="num credit">{credits(player.price)}</td>
                  <td className="num">
                    <Delta value={player.priceDeltaLast} digits={2} />
                  </td>
                  <td className="num">{num(player.projectedFp)}</td>
                  <td className="num">{num(player.valueProjected ?? player.valuePerCredit, 2)}</td>
                  <td className="num">{num(player.perf.fpAvg)}</td>
                  <td className="num">
                    {num(player.perf.form)}{" "}
                    <span className="muted" style={{ fontSize: "0.76em" }}>
                      <Delta value={player.perf.formDelta} />
                    </span>
                  </td>
                  <td className="num">
                    {num(player.perf.minutesAvg)}{" "}
                    <span style={{ fontSize: "0.76em" }}>
                      <Delta value={player.perf.minutesTrend} />
                    </span>
                  </td>
                  <td className="num">{percent(player.perf.consistency)}</td>
                  <td className="num">{num(player.schedule.difficulty, 0)}</td>
                  <td className="num">
                    <strong>{num(player.bargainScore, 0)}</strong>
                  </td>
                  <td className="hide-sm">
                    <Sparkline
                      values={(details[String(player.id)]?.recent ?? []).map((game) => game.fp)}
                      label={`Últimos partidos de ${player.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length > 120 ? (
        <p className="card-note" style={{ margin: 0 }}>
          Mostrando los 120 primeros según el orden actual. Afina los filtros para ver el resto.
        </p>
      ) : null}

      {/* En la nube el propio gráfico ya lleva su leyenda: repetirla es ruido. */}
      {view === "tabla" ? (
        <div className="chart-legend">
          {(["G", "F", "C"] as const).map((position) => (
            <span key={position}>
              <PositionBadge position={position} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
