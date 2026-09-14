"use client";

/** Consola de equipo.
 *
 *  Dos modos, uno solo de código:
 *   - conectado: si el despliegue tiene token, precarga el roster real.
 *   - manual: cualquiera puede armar los 11 y recibir el mismo análisis.
 *
 *  Esto último no es un adorno: una página que solo funciona para el dueño del
 *  token es inútil para quien abre el enlace desde fuera.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Delta, PlayerCell, prettyName } from "@/components/ui/primitives";
import { credits, num, percent, positionLabel, signed } from "@/lib/format";
import {
  DEFAULT_BUDGET,
  MAX_PER_CLUB,
  QUOTA,
  SQUAD_SIZE,
  buildSquad,
  checkSquad,
  extractRosterIds,
  positionWord,
  suggestSwaps,
} from "@/lib/squad";
import type { Player } from "@/lib/types";

const STORAGE_KEY = "efa-squad";

interface Props {
  market: Player[];
}

type RosterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; count: number };

export default function SquadConsole({ market }: Props) {
  const [ids, setIds] = useState<number[]>([]);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [roster, setRoster] = useState<RosterState>({ status: "idle" });
  const [picker, setPicker] = useState("");

  const byId = useMemo(() => new Map(market.map((player) => [player.id, player])), [market]);
  const known = useMemo(() => new Set(market.map((player) => player.id)), [market]);

  const squad = useMemo(
    () => ids.map((id) => byId.get(id)).filter((player): player is Player => Boolean(player)),
    [ids, byId],
  );

  const check = useMemo(() => checkSquad(squad, budget), [squad, budget]);
  const swaps = useMemo(
    () => (squad.length ? suggestSwaps(squad, market, budget) : []),
    [squad, market, budget],
  );

  const weakest = useMemo(
    () =>
      [...squad]
        .filter((player) => (player.perf.gamesPlayed ?? 0) > 0)
        .sort(
          (a, b) =>
            (a.valueProjected ?? a.valuePerCredit ?? 0) -
            (b.valueProjected ?? b.valuePerCredit ?? 0),
        )
        .slice(0, 3),
    [squad],
  );

  const captain = useMemo(
    () =>
      squad.reduce<Player | null>(
        (best, player) =>
          !best || (player.projectedFp ?? 0) > (best.projectedFp ?? 0) ? player : best,
        null,
      ),
    [squad],
  );

  /* ------------------------------------------------------------ persistencia */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setIds(JSON.parse(stored) as number[]);
    } catch {
      /* almacenamiento bloqueado: se sigue sin recordar la plantilla */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* idem */
    }
  }, [ids]);

  /* ---------------------------------------------------------------- acciones */
  const loadRoster = useCallback(async () => {
    setRoster({ status: "loading" });
    try {
      const response = await fetch("/api/mi-equipo");
      const data = await response.json();
      if (!data.configured) {
        setRoster({ status: "unconfigured", message: data.message });
        return;
      }
      if (!data.ok) {
        setRoster({ status: "error", message: data.message });
        return;
      }
      const found = extractRosterIds(data.payload, known);
      if (!found.length) {
        setRoster({
          status: "error",
          message:
            "La respuesta llegó bien pero no se reconoció ningún jugador. " +
            "Puede que Fantaking haya cambiado la forma del payload.",
        });
        return;
      }
      setIds(found.slice(0, SQUAD_SIZE));
      setRoster({ status: "ready", count: found.length });
    } catch (error) {
      setRoster({ status: "error", message: (error as Error).message });
    }
  }, [known]);

  function add(id: number) {
    if (!id || ids.includes(id) || ids.length >= SQUAD_SIZE) return;
    setIds((previous) => [...previous, id]);
    setPicker("");
  }

  function remove(id: number) {
    setIds((previous) => previous.filter((value) => value !== id));
  }

  function autofill() {
    setIds(buildSquad(market, budget).map((player) => player.id));
  }

  const candidates = useMemo(() => {
    const needed = (Object.keys(QUOTA) as Array<keyof typeof QUOTA>).filter(
      (position) => (check.counts[position] ?? 0) < QUOTA[position],
    );
    return market
      .filter((player) => !ids.includes(player.id))
      .filter((player) => !needed.length || needed.includes(player.position as keyof typeof QUOTA))
      .sort((a, b) => (b.bargainScore ?? 0) - (a.bargainScore ?? 0))
      .slice(0, 200);
  }, [market, ids, check.counts]);

  return (
    <div className="stack" style={{ "--gap": "24px" } as React.CSSProperties}>
      {/* ------------------------------------------------------- controles */}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <button type="button" className="chip" onClick={loadRoster}>
          {roster.status === "loading" ? "Cargando…" : "Cargar mi equipo real"}
        </button>
        <button type="button" className="chip" onClick={autofill}>
          Rellenar con el óptimo
        </button>
        <button type="button" className="chip" onClick={() => setIds([])}>
          Vaciar
        </button>
        <label className="control" style={{ marginLeft: "auto" }}>
          <span className="control-label">Presupuesto · {credits(budget)}</span>
          <input
            className="slider"
            type="range"
            min={80}
            max={130}
            step={0.5}
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
            style={{ width: 200 }}
          />
        </label>
      </div>

      {roster.status === "unconfigured" || roster.status === "error" ? (
        <div className="notice">
          <svg className="notice-icon" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.6" fill="none" />
            <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
          </svg>
          <div>
            {roster.message}
            <br />
            <span className="muted">
              Mientras tanto, arma la plantilla a mano: el análisis es exactamente el mismo.
            </span>
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- resumen */}
      <div className="grid grid-4">
        <div className="tile">
          <div className="tile-label">Plantilla</div>
          <div className="tile-value num">
            {squad.length}
            <span className="muted" style={{ fontSize: "0.5em" }}>
              /{SQUAD_SIZE}
            </span>
          </div>
          <div className="tile-sub">
            {(Object.keys(QUOTA) as Array<keyof typeof QUOTA>)
              .map((position) => `${check.counts[position] ?? 0}/${QUOTA[position]} ${positionWord(position)}`)
              .join(" · ")}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Gastado</div>
          <div className="tile-value credit">{credits(check.spent)}</div>
          <div className="tile-sub">
            {check.free >= 0 ? `${credits(check.free)} libres` : `${credits(-check.free)} de más`}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Proyección</div>
          <div className="tile-value num">{num(check.projection)}</div>
          <div className="tile-sub">
            {captain ? `Capitán sugerido: ${prettyName(captain.name)}` : "—"}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Estado</div>
          <div className="tile-value" style={{ fontSize: "1.15rem" }}>
            {check.valid ? "Válida" : squad.length < SQUAD_SIZE ? "Incompleta" : "Con problemas"}
          </div>
          <div className="tile-sub">Máx. {MAX_PER_CLUB} por club</div>
        </div>
      </div>

      {check.problems.length ? (
        <ul className="notice" style={{ display: "block", margin: 0 }}>
          {check.problems.map((problem) => (
            <li key={problem} style={{ marginLeft: 16 }}>
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ------------------------------------------------------- plantilla */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Tu plantilla</div>
          <label className="control" style={{ minWidth: 260 }}>
            <span className="sr-only">Añadir jugador</span>
            <select
              className="select"
              value={picker}
              onChange={(event) => add(Number(event.target.value))}
              disabled={ids.length >= SQUAD_SIZE}
            >
              <option value="">
                {ids.length >= SQUAD_SIZE ? "Plantilla completa" : "Añadir jugador…"}
              </option>
              {candidates.map((player) => (
                <option key={player.id} value={player.id}>
                  {prettyName(player.name)} · {player.position} · {player.clubShort} ·{" "}
                  {credits(player.price)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {squad.length ? (
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th className="num">Precio</th>
                  <th className="num">Proyección</th>
                  <th className="num">Pts/cr</th>
                  <th className="num">Fiabilidad</th>
                  <th className="num">Calendario</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {squad.map((player) => (
                  <tr key={player.id}>
                    <td>
                      <PlayerCell player={player} />
                    </td>
                    <td className="num credit">{credits(player.price)}</td>
                    <td className="num">{num(player.projectedFp)}</td>
                    <td className="num">
                      {num(player.valueProjected ?? player.valuePerCredit, 2)}
                    </td>
                    <td className="num">{percent(player.perf.consistency)}</td>
                    <td className="num">{num(player.schedule.difficulty, 0)}</td>
                    <td>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => remove(player.id)}
                        aria-label={`Quitar a ${prettyName(player.name)}`}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Añade jugadores desde el selector, carga tu equipo real o deja que lo rellene el
            optimizador.
          </p>
        )}
      </div>

      {/* ----------------------------------------------------- diagnóstico */}
      {squad.length ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Lo que menos te renta</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Peor relación entre lo que proyecta y lo que ocupa de tu presupuesto.
                </p>
              </div>
            </div>
            {weakest.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {weakest.map((player) => (
                  <li
                    key={player.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 0",
                      borderTop: "1px solid var(--hairline)",
                    }}
                  >
                    <PlayerCell player={player} />
                    <span className="num">
                      {num(player.valueProjected ?? player.valuePerCredit, 2)} pts/cr
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Sin partidos jugados todavía para valorar el rendimiento.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Fichajes que caben</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Mejor recambio por puesto dentro de tus {credits(Math.max(check.free, 0))} libres
                  más lo que recuperas al vender.
                </p>
              </div>
            </div>
            {swaps.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {swaps.map((swap) => (
                  <li
                    key={`${swap.out.id}-${swap.in.id}`}
                    style={{ padding: "10px 0", borderTop: "1px solid var(--hairline)" }}
                  >
                    <div className="spread" style={{ gap: 8 }}>
                      <span>
                        <span className="muted">Sale</span>{" "}
                        <strong>{prettyName(swap.out.name)}</strong>{" "}
                        <span className="muted num">({credits(swap.out.price)})</span>
                      </span>
                      <span className="delta delta-up num">{signed(swap.gain)} pts</span>
                    </div>
                    <div className="spread" style={{ gap: 8 }}>
                      <span>
                        <span className="muted">Entra</span>{" "}
                        <strong>{prettyName(swap.in.name)}</strong>{" "}
                        <span className="muted num">
                          ({credits(swap.in.price)} · {swap.in.clubShort} ·{" "}
                          {positionLabel(swap.in.position)})
                        </span>
                      </span>
                      <span className="num muted">
                        <Delta value={swap.costDelta} digits={1} suffix=" cr" />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No hay mejora posible dentro del presupuesto con los datos actuales.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
