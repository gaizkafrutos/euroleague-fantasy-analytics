"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import Avatar from "@/components/ui/Avatar";
import { credits, normalize, num, percent, positionLabel, signed } from "@/lib/format";
import { fixtureLabel, turnLabel } from "@/lib/projection";
import type { NextGame } from "@/lib/types";

export interface CompareRow {
  id: number;
  name: string;
  club: string;
  position: string | null;
  isCoach: boolean;
  image: string | null;
  price: number | null;
  projectedFp: number | null;
  projectedIfPlays: number | null;
  playProb: number | null;
  valueProjected: number | null;
  expectedMinutes: number | null;
  fpAvg: number | null;
  lastFp: number | null;
  form: number | null;
  consistency: number | null;
  gamesPlayed: number | null;
  startedRate: number | null;
  ptsAvg: number | null;
  rebAvg: number | null;
  astAvg: number | null;
  pirAvg: number | null;
  floor: number | null;
  ceiling: number | null;
  p90: number | null;
  expectedChange: number | null;
  riseProb: number | null;
  difficulty: number | null;
  next: NextGame | null;
  bargainScore: number | null;
  availability: string | null;
  out: boolean;
}

/** Lo mínimo para buscar y validar la URL; va en el HTML. */
export interface CompareIndexEntry {
  id: number;
  name: string;
  club: string;
  position: string | null;
  isCoach: boolean;
  price: number | null;
}

/** Filas completas: se piden a `/comparar/datos` cuando hay a quién comparar. */
const DATA_URL = "/comparar/datos";

const MAX = 4;

interface Metric {
  label: string;
  title?: string;
  value: (row: CompareRow) => number | null;
  show: (row: CompareRow) => string;
  /** Qué es mejor. Sin él, la fila no marca a nadie. */
  better?: "high" | "low";
  /** No aplica a entrenadores. */
  playersOnly?: boolean;
}

const METRICS: Array<{ group: string; rows: Metric[] }> = [
  {
    group: "Próxima jornada",
    rows: [
      {
        label: "Proyección",
        title: "Puntos esperados, ya descontada la probabilidad de que no juegue",
        value: (r) => r.projectedFp,
        show: (r) => num(r.projectedFp),
        better: "high",
      },
      {
        label: "Si juega",
        value: (r) => r.projectedIfPlays,
        show: (r) => num(r.projectedIfPlays),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Probabilidad de jugar",
        value: (r) => r.playProb,
        show: (r) => percent(r.playProb),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Minutos esperados",
        value: (r) => r.expectedMinutes,
        show: (r) => num(r.expectedMinutes),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Rango habitual",
        title: "Entre qué cifras cae la mitad de las veces (percentiles 25 y 75)",
        value: (r) => r.floor,
        show: (r) => (r.floor === null ? "—" : `${num(r.floor)}–${num(r.ceiling)}`),
        better: "high",
      },
      {
        label: "Techo",
        title: "Lo que hace en una buena noche: lo que importa para el capitán",
        value: (r) => r.p90,
        show: (r) => num(r.p90),
        better: "high",
      },
      {
        label: "Rival",
        value: () => null,
        show: (r) =>
          r.next
            ? `${fixtureLabel(r.next)}${turnLabel(r.next) ? ` · ${turnLabel(r.next)}` : ""}`
            : "—",
      },
      {
        label: "Probabilidad de ganar",
        value: (r) => r.next?.winProb ?? null,
        show: (r) => percent(r.next?.winProb ?? null),
        better: "high",
      },
    ],
  },
  {
    group: "Precio",
    rows: [
      { label: "Precio", value: (r) => r.price, show: (r) => credits(r.price) },
      {
        label: "Puntos por crédito",
        value: (r) => r.valueProjected,
        show: (r) => num(r.valueProjected, 2),
        better: "high",
      },
      {
        label: "Revalorización esperada",
        value: (r) => (r.out ? null : r.expectedChange),
        show: (r) => (r.out || r.expectedChange === null ? "—" : `${signed(r.expectedChange)} cr`),
        better: "high",
      },
      {
        label: "Probabilidad de subir",
        value: (r) => (r.out ? null : r.riseProb),
        show: (r) => (r.out ? "—" : percent(r.riseProb)),
        better: "high",
      },
      {
        label: "Índice de chollo",
        value: (r) => r.bargainScore,
        show: (r) => num(r.bargainScore, 0),
        better: "high",
      },
    ],
  },
  {
    group: "Temporada",
    rows: [
      {
        label: "Media fantasy",
        value: (r) => r.fpAvg,
        show: (r) => num(r.fpAvg),
        better: "high",
      },
      {
        label: "Último partido",
        value: (r) => r.lastFp,
        show: (r) => num(r.lastFp),
        better: "high",
      },
      {
        label: "Partidos jugados",
        value: (r) => r.gamesPlayed,
        show: (r) => num(r.gamesPlayed, 0),
        playersOnly: true,
      },
      {
        label: "Regularidad",
        value: (r) => r.consistency,
        show: (r) => (r.consistency === null ? "—" : percent(r.consistency)),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Titular",
        value: (r) => r.startedRate,
        show: (r) => percent(r.startedRate),
        better: "high",
        playersOnly: true,
      },
      { label: "Puntos", value: (r) => r.ptsAvg, show: (r) => num(r.ptsAvg), better: "high", playersOnly: true },
      { label: "Rebotes", value: (r) => r.rebAvg, show: (r) => num(r.rebAvg), better: "high", playersOnly: true },
      {
        label: "Asistencias",
        value: (r) => r.astAvg,
        show: (r) => num(r.astAvg),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Valoración",
        value: (r) => r.pirAvg,
        show: (r) => num(r.pirAvg),
        better: "high",
        playersOnly: true,
      },
      {
        label: "Calendario (3 próximos)",
        title: "Dificultad de los tres próximos rivales: 100 es lo más duro",
        value: (r) => r.difficulty,
        show: (r) => num(r.difficulty, 0),
      },
    ],
  },
];

/** Valores de una métrica y quién la gana. El empate se decide con la cifra
 *  que se ve: 24,83 contra 24,79 se lee "24,8 y 24,8" y no puede marcar a uno
 *  solo. */
function rankMetric(metric: Metric, picked: CompareRow[]) {
  const values = picked.map((row) => (metric.playersOnly && row.isCoach ? null : metric.value(row)));
  const shown = picked.map((row) => (metric.playersOnly && row.isCoach ? "—" : metric.show(row)));
  const numeric = values.filter((value): value is number => typeof value === "number");
  let winner = -1;
  if (metric.better && numeric.length > 1) {
    const best = metric.better === "high" ? Math.max(...numeric) : Math.min(...numeric);
    const index = values.indexOf(best);
    const tied = shown.filter((text) => text === shown[index]).length > 1;
    if (!tied) winner = index;
  }
  return { shown, winner };
}

/** Apellido para la cabecera estrecha del móvil. */
function surname(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export default function Comparator({ index: entries }: { index: CompareIndexEntry[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const known = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);
  const ids = (params.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((id, index, list) => known.has(id) && list.indexOf(id) === index)
    .slice(0, MAX);

  const [full, setFull] = useState<Map<number, CompareRow> | null>(null);
  const [failed, setFailed] = useState(false);
  const wanted = ids.length > 0;
  useEffect(() => {
    if (!wanted || full) return;
    let cancelled = false;
    fetch(DATA_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((rows: CompareRow[]) => {
        if (!cancelled) setFull(new Map(rows.map((row) => [row.id, row])));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, full]);
  const picked = full ? ids.map((id) => full.get(id)).filter((row): row is CompareRow => Boolean(row)) : [];

  const [query, setQuery] = useState("");
  const index = useMemo(
    () => entries.map((row) => ({ row, haystack: normalize(`${row.name} ${row.club}`) })),
    [entries],
  );
  const needle = normalize(query);
  const results =
    needle.length >= 2
      ? index
          .filter((entry) => entry.haystack.includes(needle) && !ids.includes(entry.row.id))
          .slice(0, 6)
          .map((entry) => entry.row)
      : [];

  function setIds(next: number[]) {
    const search = next.length ? `?ids=${next.join(",")}` : "";
    router.replace(`/comparar${search}`, { scroll: false });
  }

  const onlyCoaches = picked.length > 0 && picked.every((row) => row.isCoach);
  const anyCoach = picked.some((row) => row.isCoach);

  return (
    <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
      {ids.length < MAX ? (
        <div className="compare-picker">
          <label className="control">
            <span className="control-label">
              Añadir jugador ({ids.length}/{MAX})
            </span>
            <input
              className="input"
              type="search"
              placeholder="Nombre o equipo"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {results.length ? (
            <ul className="compare-results">
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setIds([...ids, row.id]);
                      setQuery("");
                    }}
                  >
                    <b>{row.name}</b>{" "}
                    <span className="muted">
                      {row.club} · {row.isCoach ? "Entrenador" : positionLabel(row.position)} ·{" "}
                      {credits(row.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {ids.length === 0 ? (
        <p className="muted">
          Busca a dos o más jugadores para verlos cara a cara. También puedes llegar aquí con el
          botón «Comparar» de cualquier ficha.
        </p>
      ) : failed ? (
        <p className="muted">No se han podido cargar los datos. Recarga la página para reintentarlo.</p>
      ) : !full ? (
        <p className="muted">Cargando la comparación…</p>
      ) : (
        <div className="table-wrap compare-desktop" tabIndex={0} role="region" aria-label="Comparación">
          <table className="data compare-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Métrica</span>
                </th>
                {picked.map((row) => (
                  <th key={row.id} scope="col" className="num">
                    <Link href={`/jugador/${row.id}`} className="player-name">
                      {row.name}
                    </Link>
                    <span className="compare-sub">
                      {row.club} · {row.isCoach ? "Entrenador" : positionLabel(row.position)}
                    </span>
                    {row.availability ? <span className="compare-avail">{row.availability}</span> : null}
                    <button
                      type="button"
                      className="button-ghost compare-remove"
                      onClick={() => setIds(ids.filter((id) => id !== row.id))}
                      aria-label={`Quitar a ${row.name} de la comparación`}
                    >
                      Quitar
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {METRICS.map((group) => (
              <tbody key={group.group}>
                <tr className="compare-group">
                  <th scope="rowgroup" colSpan={picked.length + 1}>
                    {group.group}
                  </th>
                </tr>
                {group.rows
                  .filter((metric) => !(metric.playersOnly && onlyCoaches))
                  .map((metric) => {
                    const { shown, winner } = rankMetric(metric, picked);
                    return (
                      <tr key={metric.label}>
                        <th scope="row" title={metric.title}>
                          {metric.label}
                        </th>
                        {picked.map((row, column) => (
                          <td key={row.id} className={`num${column === winner ? " is-best" : ""}`}>
                            {shown[column]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {/* Móvil: la tabla dejaba ver un jugador y pico con la cabecera fuera de
          la pantalla. Aquí la cabecera se queda fija arriba y cada métrica
          es una fila de valores en el mismo orden que las fotos. */}
      {full && picked.length ? (
        <div className="compare-mobile" style={{ "--n": picked.length } as React.CSSProperties}>
          <div className="compare-heads">
            {picked.map((row) => (
              <div key={row.id} className="compare-head">
                <Link href={`/jugador/${row.id}`} className="compare-head-link">
                  <Avatar src={row.image} name={row.name} className="avatar compare-avatar" />
                  <span className="compare-head-name">{surname(row.name)}</span>
                  <span className="compare-head-sub">{row.club}</span>
                </Link>
                <button
                  type="button"
                  className="compare-head-remove"
                  onClick={() => setIds(ids.filter((id) => id !== row.id))}
                  aria-label={`Quitar a ${row.name} de la comparación`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {METRICS.map((group) => (
            <section key={group.group} className="compare-sec" aria-label={group.group}>
              <h2 className="compare-sec-title">{group.group}</h2>
              <dl>
                {group.rows
                  .filter((metric) => !(metric.playersOnly && onlyCoaches))
                  .map((metric) => {
                    const { shown, winner } = rankMetric(metric, picked);
                    return (
                      <div key={metric.label} className="compare-metric">
                        <dt title={metric.title}>{metric.label}</dt>
                        <dd className="compare-vals">
                          {picked.map((row, column) => (
                            <span
                              key={row.id}
                              className={`num${column === winner ? " is-best" : ""}`}
                              aria-label={`${row.name}: ${shown[column]}`}
                            >
                              {shown[column]}
                            </span>
                          ))}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
            </section>
          ))}
        </div>
      ) : null}
      {anyCoach && !onlyCoaches ? (
        <p className="card-note" style={{ margin: 0 }}>
          El entrenador puntúa solo por el resultado de su equipo: las filas de minutos y medias de
          caja no le aplican.
        </p>
      ) : null}
    </div>
  );
}
