"use client";

/** Explorador de mercado.
 *
 *  Tres decisiones de diseño que no son obvias:
 *
 *  1. En móvil no hay tabla. Una tabla de once columnas en 390 px es scroll
 *     horizontal, y nadie compara jugadores haciendo scroll lateral. Ahí se
 *     pintan fichas, con las tres cifras que deciden y nada más.
 *  2. Tres columnas llevan barra de fondo. Solo tres: si la llevaran todas, la
 *     tabla sería un gráfico de barras ilegible.
 *  3. Los filtros viven en la URL. Si filtras pívots por debajo de 12 créditos
 *     y pasas el enlace, al otro lado se ve lo mismo que estás viendo tú.
 */
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import Sparkline from "@/components/charts/Sparkline";
import AddToSquad from "@/components/team/AddToSquad";
import ValueScatter from "@/components/charts/ValueScatter";
import { BarCell, Delta, PlayerCell, PositionBadge } from "@/components/ui/primitives";
import { credits, displayName, num, percent } from "@/lib/format";
import { fixtureLabel, playRisk, projectionNote, turnLabel } from "@/lib/projection";
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
  | "expectedChange"
  | "difficulty";

const PAGE_SIZE = 50;

const COLUMNS: Array<{ key: SortKey; label: string; title: string }> = [
  // Precio y variación comparten celda: son el mismo dato mirado a dos tiempos,
  // y la tabla ya usa ese patrón en Forma y en Minutos.
  { key: "price", label: "Precio", title: "Precio y variación en la última jornada" },
  {
    key: "expectedChange",
    label: "Revalor.",
    title: "Variación de precio esperada si puntúa lo proyectado (créditos)",
  },
  {
    key: "projectedFp",
    label: "Proyección",
    title: "Puntos fantasy esperados la próxima jornada, ya descontada la probabilidad de que no juegue",
  },
  { key: "valueProjected", label: "Pts/cr", title: "Puntos proyectados por crédito" },
  { key: "fpAvg", label: "Media", title: "Media de puntos fantasy por partido jugado" },
  { key: "minutesAvg", label: "Min", title: "Minutos por partido y su tendencia (los esperados, en el detalle)" },
  { key: "consistency", label: "Fiabilidad", title: "1 = regular, 0 = lotería" },
  {
    key: "difficulty",
    label: "Calendario",
    title: "Próximo rival y dificultad de los 3 próximos (100 = lo más duro)",
  },
  { key: "bargainScore", label: "Índice", title: "Índice compuesto de chollo" },
];

/** Las columnas que llevan barra proporcional. */
const BARRED: Partial<Record<SortKey, true>> = {
  projectedFp: true,
  valueProjected: true,
  bargainScore: true,
};

function metric(player: Player, key: SortKey): number | null {
  switch (key) {
    case "price":
      return player.price;
    case "priceDeltaLast":
      return player.priceDeltaLast;
    case "expectedChange":
      return player.outlook?.expectedChange ?? null;
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
}

interface Props {
  players: Player[];
  teams: Team[];
  details: Record<string, { recent: Array<{ fp: number }> }>;
  hasPrices: boolean;
}

export default function MarketExplorer({ players, teams, details, hasPrices }: Props) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [positions, setPositions] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState("");
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minGames, setMinGames] = useState(0);
  const [risingOnly, setRisingOnly] = useState(false);
  const [minPrice, setMinPrice] = useState(0);
  const [hideOut, setHideOut] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: hasPrices ? "bargainScore" : "fpAvg",
    desc: true,
  });
  const [view, setView] = useState<"tabla" | "grafico">("tabla");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const hydrated = useRef(false);

  const priceCeiling = useMemo(() => {
    const prices = players.map((p) => p.price ?? 0).filter((value) => value > 0);
    return prices.length ? Math.ceil(Math.max(...prices)) : 30;
  }, [players]);

  /* ------------------------------------------------------------- URL: leer */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pos = params.get("pos");
    if (pos) setPositions(new Set(pos.split(",").filter((value) => "GFC".includes(value))));
    if (params.get("q")) setQuery(params.get("q") ?? "");
    if (params.get("club")) setTeam(params.get("club") ?? "");
    const max = Number(params.get("max"));
    if (max > 0) setMaxPrice(max);
    const games = Number(params.get("min"));
    if (games > 0) setMinGames(games);
    if (params.get("alza") === "1") setRisingOnly(true);
    const floor = Number(params.get("desde"));
    if (floor > 0) setMinPrice(floor);
    if (params.get("sinbajas") === "1") setHideOut(true);
    if (params.get("vista") === "grafico") setView("grafico");
    const key = params.get("orden") as SortKey | null;
    if (key && COLUMNS.some((column) => column.key === key)) {
      setSort({ key, desc: params.get("dir") !== "asc" });
    }
    hydrated.current = true;
  }, []);

  /* ----------------------------------------------------------- URL: escribir */
  useEffect(() => {
    // Antes de leer la URL no se escribe: si no, el primer render la borraría.
    if (!hydrated.current) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (positions.size) params.set("pos", [...positions].join(","));
    if (team) params.set("club", team);
    if (maxPrice !== null && maxPrice < priceCeiling) params.set("max", String(maxPrice));
    if (minGames) params.set("min", String(minGames));
    if (risingOnly) params.set("alza", "1");
    if (minPrice) params.set("desde", String(minPrice));
    if (hideOut) params.set("sinbajas", "1");
    if (view === "grafico") params.set("vista", "grafico");
    const isDefaultSort = sort.key === (hasPrices ? "bargainScore" : "fpAvg") && sort.desc;
    if (!isDefaultSort) {
      params.set("orden", sort.key);
      if (!sort.desc) params.set("dir", "asc");
    }
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [query, positions, team, maxPrice, minPrice, hideOut, minGames, risingOnly, view, sort, priceCeiling, hasPrices]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return players.filter((player) => {
      // Se busca también por el nombre del mercado: los que no cruzan con el
      // censo no tienen `name`, y sin esto eran inencontrables.
      const haystack = `${player.name ?? ""} ${player.marketName ?? ""} ${player.clubName ?? ""}`;
      if (needle && !haystack.toLowerCase().includes(needle)) return false;
      if (positions.size && (!player.position || !positions.has(player.position))) return false;
      if (team && player.club !== team) return false;
      if (maxPrice !== null && (player.price ?? 0) > maxPrice) return false;
      if (minGames && (player.perf.gamesPlayed ?? 0) < minGames) return false;
      if (risingOnly && (player.perf.minutesShareTrend ?? 0) <= 0) return false;
      if (minPrice && (player.price ?? 0) < minPrice) return false;
      if (hideOut && (player.availability?.level === "out" || player.registered === false)) return false;
      return true;
    });
  }, [players, deferredQuery, positions, team, maxPrice, minPrice, hideOut, minGames, risingOnly]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const left = metric(a, sort.key);
      const right = metric(b, sort.key);
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return sort.desc ? right - left : left - right;
    });
  }, [filtered, sort]);

  /** Rango de cada columna con barra, sobre lo que hay filtrado.
   *
   *  Se normaliza entre el mínimo y el máximo de lo filtrado, no entre 0 y el
   *  máximo: las proyecciones van de 8 a 31 y los puntos por crédito de 0,7 a
   *  1,6, así que midiendo desde cero todas las barras salen casi iguales y la
   *  columna deja de comparar nada. Con un suelo del 6% para que la peor barra
   *  siga siendo visible en vez de leerse como un cero. */
  const ranges = useMemo(() => {
    const result = {} as Record<SortKey, { min: number; span: number }>;
    for (const key of Object.keys(BARRED) as SortKey[]) {
      let min = Infinity;
      let max = -Infinity;
      for (const player of filtered) {
        const value = metric(player, key);
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      result[key] = Number.isFinite(min)
        ? { min, span: max - min || Math.abs(max) || 1 }
        : { min: 0, span: 1 };
    }
    return result;
  }, [filtered]);

  function share(value: number | null | undefined, key: SortKey): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const { min, span } = ranges[key];
    return 0.06 + 0.94 * Math.max(0, Math.min(1, (value - min) / span));
  }

  const activeFilters =
    positions.size +
    (team ? 1 : 0) +
    (maxPrice !== null && maxPrice < priceCeiling ? 1 : 0) +
    (minGames ? 1 : 0) +
    (minPrice ? 1 : 0) +
    (hideOut ? 1 : 0) +
    (risingOnly ? 1 : 0);

  // Cualquier cambio de filtro u orden reinicia la paginación: si no, el
  // usuario se queda mirando la fila 80 de una lista que ya es otra.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [deferredQuery, positions, team, maxPrice, minPrice, hideOut, minGames, risingOnly, sort]);

  function togglePosition(position: string) {
    setPositions((previous) => {
      const next = new Set(previous);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  function applySort(key: SortKey) {
    setSort((previous) => (previous.key === key ? { key, desc: !previous.desc } : { key, desc: true }));
  }

  function reset() {
    setQuery("");
    setPositions(new Set());
    setTeam("");
    setMaxPrice(null);
    setMinGames(0);
    setMinPrice(0);
    setHideOut(false);
    setRisingOnly(false);
  }

  /** Clic en cualquier punto de la fila. El enlace del nombre sigue ahí para el
   *  teclado y para "abrir en pestaña nueva"; esto es solo comodidad. */
  function openPlayer(event: React.MouseEvent<HTMLTableRowElement>, id: number) {
    const target = event.target as HTMLElement;
    if (target.closest("a, button")) return;
    router.push(`/jugador/${id}`);
  }

  const rows = sorted.slice(0, visible);

  return (
    <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
      {/* ---------------------------------------------------------- filtros */}
      <div className="filter-bar">
        <label className="control filter-search">
          <span className="sr-only">Buscar en la tabla</span>
          <input
            className="input"
            type="search"
            placeholder="Filtrar por jugador o equipo"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="chip filter-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filtros
          {activeFilters ? <span className="chip-count">{activeFilters}</span> : null}
        </button>

        <div className="segmented filter-view">
          <button type="button" aria-pressed={view === "tabla"} onClick={() => setView("tabla")}>
            Tabla
          </button>
          <button type="button" aria-pressed={view === "grafico"} onClick={() => setView("grafico")}>
            Nube
          </button>
        </div>
      </div>

      <div className={`filter-panel${filtersOpen ? " is-open" : ""}`}>
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
          <label className="control filter-price">
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

        {hasPrices ? (
          <label className="control">
            <span className="control-label">Precio mínimo</span>
            <select
              className="select"
              value={minPrice}
              onChange={(event) => setMinPrice(Number(event.target.value))}
            >
              {[0, 5, 8, 10, 12, 15].map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? "Sin mínimo" : `${value} cr o más`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="control">
          <span className="control-label">Disponibilidad</span>
          <button
            type="button"
            className="chip"
            aria-pressed={hideOut}
            onClick={() => setHideOut((value) => !value)}
            title="Quita a los que están de baja para la próxima jornada o sin inscribir"
          >
            Ocultar bajas
          </button>
        </div>

        <div className="control">
          <span className="control-label">Rotación</span>
          <button
            type="button"
            className="chip"
            aria-pressed={risingOnly}
            onClick={() => setRisingOnly((value) => !value)}
            title="Solo jugadores que están ganando peso en la rotación de su equipo"
          >
            Rol al alza
          </button>
        </div>

        {/* Ordenar sin cabecera de tabla: en el móvil no hay dónde pinchar. */}
        <label className="control filter-sort">
          <span className="control-label">Ordenar por</span>
          <select
            className="select"
            value={sort.key}
            onChange={(event) => setSort({ key: event.target.value as SortKey, desc: true })}
          >
            {COLUMNS.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>

        {activeFilters ? (
          <button type="button" className="button-ghost filter-reset" onClick={reset}>
            Limpiar filtros
          </button>
        ) : null}
      </div>

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
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0 }}>Ningún jugador cumple esos filtros.</p>
          <button type="button" className="button-ghost" onClick={reset}>
            Limpiar filtros
          </button>
        </div>
      ) : (
        <>
          {/* -------------------------------------------------- escritorio */}
          <div className="table-wrap only-wide" tabIndex={0} role="region" aria-label="Tabla del mercado">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Jugador</th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className="num"
                      aria-sort={
                        sort.key === column.key
                          ? sort.desc
                            ? "descending"
                            : "ascending"
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        className="th-sort"
                        title={column.title}
                        onClick={() => applySort(column.key)}
                      >
                        {column.label}
                        <span className="th-arrow" aria-hidden>
                          {sort.key === column.key ? (sort.desc ? "↓" : "↑") : ""}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th scope="col">Últimos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((player) => (
                  <tr
                    key={player.id}
                    className="is-clickable"
                    onClick={(event) => openPlayer(event, player.id)}
                  >
                    <td>
                      {/* El botón va en la celda del nombre: una columna más no
                          cabía a 1440 px. */}
                      <span className="player-cell-row">
                        <PlayerCell player={player} />
                        <AddToSquad id={player.id} name={displayName(player)} compact />
                      </span>
                    </td>
                    <td className="num" title={priceTitle(player)}>
                      <span className="credit">{credits(player.price)}</span>{" "}
                      <span style={{ fontSize: "0.76em" }}>
                        <Delta value={player.priceDeltaLast} digits={1} quiet />
                      </span>
                    </td>
                    <td className="num">
                      <Revalue player={player} />
                    </td>
                    <td className="num" title={projectionNote(player)}>
                      <span className="projection-cell">
                        <BarCell
                          value={player.projectedFp}
                          fraction={share(player.projectedFp, "projectedFp")}
                        />
                        <PlayRisk player={player} />
                      </span>
                    </td>
                    <td className="num">
                      <BarCell
                        value={player.valueProjected ?? player.valuePerCredit}
                        fraction={share(
                          player.valueProjected ?? player.valuePerCredit,
                          "valueProjected",
                        )}
                        digits={2}
                      />
                    </td>
                    {/* Media y forma comparten celda: la forma es la media de los
                        últimos cinco, y lo que importa de ella es cuánto se
                        separa de la media. Una columna menos cabe a 1280 px. */}
                    <td
                      className="num"
                      title={`Último partido: ${num(player.perf.lastFp)} · forma (últimos 5): ${num(player.perf.form)}`}
                    >
                      {num(player.perf.fpAvg)}{" "}
                      <span className="muted" style={{ fontSize: "0.76em" }}>
                        <Delta value={player.perf.formDelta} quiet />
                      </span>
                    </td>
                    <td
                      className="num"
                      title={
                        typeof player.expectedMinutes === "number"
                          ? `Esperados la próxima jornada: ${num(player.expectedMinutes)} min`
                          : undefined
                      }
                    >
                      {num(player.perf.minutesAvg)}{" "}
                      <span style={{ fontSize: "0.76em" }}>
                        <Delta value={player.perf.minutesTrend} quiet />
                      </span>
                    </td>
                    <td className="num">{reliable(player)}</td>
                    <td className="num" title={nextTitle(player)}>
                      <span className="muted" style={{ fontSize: "0.8em" }}>
                        {player.schedule.next ? fixtureLabel(player.schedule.next) : ""}
                      </span>{" "}
                      {num(player.schedule.difficulty, 0)}
                    </td>
                    <td className="num">
                      <BarCell
                        value={player.bargainScore}
                        fraction={share(player.bargainScore, "bargainScore")}
                        digits={0}
                        strong
                      />
                    </td>
                    <td>
                      <Sparkline
                        values={(details[String(player.id)]?.recent ?? []).map((game) => game.fp)}
                        label={`Últimos partidos de ${displayName(player)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------------------------------------------------------- móvil */}
          <ul className="player-cards only-narrow">
            {rows.map((player) => (
              <li key={player.id}>
                <a className="player-card" href={`/jugador/${player.id}`}>
                  {/* La tarjeta ya es el enlace: la celda va sin el suyo. */}
                  <PlayerCell player={player} linked={false} />
                  <span className="player-card-price credit num">{credits(player.price)}</span>
                  <span className="player-card-stats">
                    <span>
                      <b className="num">{num(player.projectedFp)}</b>
                      <i>
                        {playRisk(player) !== null
                          ? `proy. · ${percent(playRisk(player))} juega`
                          : `proy. ${player.schedule.next ? fixtureLabel(player.schedule.next) : ""}`}
                      </i>
                    </span>
                    <span>
                      <b className="num">
                        {num(player.valueProjected ?? player.valuePerCredit, 2)}
                      </b>
                      <i>pts/cr</i>
                    </span>
                    <span>
                      <b className="num">
                        <Revalue player={player} />
                      </b>
                      <i>revalor.</i>
                    </span>
                    <span>
                      <b className="num">{reliable(player)}</b>
                      <i>fiabilidad</i>
                    </span>
                  </span>
                  {/* Índice de chollo como barra: la cifra suelta no dice nada
                      sin el resto de la columna delante. */}
                  <span className="player-card-bar">
                    <i>índice {num(player.bargainScore, 0)}</i>
                    <span aria-hidden>
                      <span style={{ width: `${(share(player.bargainScore, "bargainScore") ?? 0) * 100}%` }} />
                    </span>
                  </span>
                </a>
                {/* Fuera del enlace: un botón dentro de un <a> es HTML inválido. */}
                <div className="player-card-actions">
                  <AddToSquad id={player.id} name={displayName(player)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {view === "tabla" && sorted.length > 0 ? (
        <div className="table-footer">
          <span className="num">
            {Math.min(visible, sorted.length)} de {sorted.length}
            {sorted.length !== players.length ? ` (${players.length} en total)` : ""}
          </span>
          {visible < sorted.length ? (
            <button
              type="button"
              className="button-ghost"
              onClick={() => setVisible((current) => current + PAGE_SIZE)}
            >
              Mostrar {Math.min(PAGE_SIZE, sorted.length - visible)} más
            </button>
          ) : null}
        </div>
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

/** Aviso de que la proyección lleva descontada la probabilidad de no jugar. */
function PlayRisk({ player }: { player: Player }) {
  const risk = playRisk(player);
  if (risk === null) return null;
  return (
    <span className={`play-risk${risk === 0 ? " is-out" : ""}`} aria-label={`${percent(risk)} de que juegue`}>
      {percent(risk)}
    </span>
  );
}

function nextTitle(player: Player): string | undefined {
  const next = player.schedule.next;
  if (!next) return undefined;
  const turn = turnLabel(next);
  return [
    `${fixtureLabel(next)} el ${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", timeZone: "Europe/Madrid" }).format(new Date(next.date))}`,
    turn ? `turno ${next.turn} de ${next.turns}` : null,
    `${percent(next.winProb)} de ganar`,
    next.restDays !== null ? `${next.restDays} días de descanso` : null,
    next.doubleWeek ? "semana doble" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Variación de precio esperada, con la probabilidad en el title. Verde/rojo
 *  vía `deltaClass`, como el resto de variaciones de la tabla. */
function Revalue({ player }: { player: Player }) {
  const outlook = player.outlook;
  if (!outlook || player.availability?.level === "out") return <span className="muted">—</span>;
  const change = Math.round(outlook.expectedChange * 10) / 10;
  return (
    <span
      title={`Umbral ${num(outlook.breakEven)} pts · ${percent(outlook.riseProb)} de probabilidad de subir`}
    >
      <Delta value={change} digits={1} />
    </span>
  );
}

/** Con menos de tres partidos la fiabilidad propia no existe: el pipeline la
 *  estima con la dispersión encogida hacia el año pasado, y se marca con "≈". */
function reliable(player: Player): string {
  if (player.perf.consistency === null || player.perf.consistency === undefined) return "—";
  if (player.perf.consistencyEstimated) return `≈${percent(player.perf.consistency)}`;
  return (player.perf.gamesPlayed ?? 0) >= 3 ? percent(player.perf.consistency) : "—";
}

/** Con precios desfasados, el precio es el pendiente: el title dice cuál enseña
 *  el juego ahora mismo. */
function priceTitle(player: Player): string | undefined {
  if (typeof player.priceGame === "number") {
    return `Precio al cerrar la jornada (${
      player.pricePendingSource === "modelo" ? "estimado" : "calculado por el juego"
    }). Ahora mismo en el juego: ${credits(player.priceGame)}.`;
  }
  return player.priceDeltaLast ? "Variación en la última jornada" : undefined;
}
