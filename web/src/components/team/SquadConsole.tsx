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
  /** Proyección del once óptimo, para medir cuánto se deja sobre la mesa. */
  optimalProjection?: number | null;
}

type RosterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; count: number };

export default function SquadConsole({ market, optimalProjection }: Props) {
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
      <div className="squad-controls">
        <button type="button" className="chip" onClick={loadRoster}>
          {roster.status === "loading" ? "Cargando…" : "Cargar mi equipo real"}
        </button>
        <button type="button" className="chip" onClick={autofill}>
          Rellenar con el óptimo
        </button>
        <button type="button" className="chip" onClick={() => setIds([])}>
          Vaciar
        </button>
        <label className="control squad-budget">
          <span className="control-label">Presupuesto · {credits(budget)}</span>
          <input
            className="slider"
            type="range"
            min={80}
            max={130}
            step={0.5}
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
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
        {/* La cifra que de verdad se quiere saber aquí: cuánto se deja sobre la
            mesa respecto a la mejor plantilla posible con el mismo dinero. */}
        <div className="tile">
          <div className="tile-label">Frente al óptimo</div>
          {typeof optimalProjection === "number" && squad.length ? (
            <>
              <div
                className={`tile-value num ${
                  check.projection >= optimalProjection - 0.05 ? "delta-up" : "delta-down"
                }`}
              >
                {signed(check.projection - optimalProjection)}
              </div>
              <div className="tile-sub">
                puntos respecto a los {num(optimalProjection)} del once óptimo
              </div>
            </>
          ) : (
            <>
              <div className="tile-value" style={{ fontSize: "1.15rem" }}>
                {check.valid ? "Válida" : squad.length < SQUAD_SIZE ? "Incompleta" : "Con problemas"}
              </div>
              <div className="tile-sub">Máx. {MAX_PER_CLUB} por club</div>
            </>
          )}
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
          <>
            <div className="table-wrap only-wide" style={{ border: 0 }}>
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

            {/* En el móvil, una fila por jugador con el botón de quitar a un
                toque: la tabla de siete columnas ahí no se puede usar. */}
            <ul className="squad-list only-narrow">
              {squad.map((player) => (
                <li key={player.id}>
                  <PlayerCell player={player} />
                  <span className="squad-figures">
                    <b className="num">{num(player.projectedFp)}</b>
                    <i className="credit num">{credits(player.price)}</i>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => remove(player.id)}
                    aria-label={`Quitar a ${prettyName(player.name)}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </>
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
              <ol className="rank-list">
                {weakest.map((player) => (
                  <li key={player.id}>
                    <PlayerCell player={player} />
                    {/* Sin rojo: que sea el que menos renta de TU plantilla no
                        lo convierte en un mal jugador, y pintarlo de alarma
                        dice algo que el dato no dice. El orden ya ordena. */}
                    <span className="rank-value">
                      {num(player.valueProjected ?? player.valuePerCredit, 2)}
                      <span className="muted" style={{ fontSize: "0.7em", fontWeight: 500 }}>
                        {" "}
                        pts/cr
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
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
              <ul className="swap-list">
                {swaps.map((swap) => (
                  <li key={`${swap.out.id}-${swap.in.id}`}>
                    <div className="swap-move">
                      <span className="swap-out">
                        <span className="muted">Sale</span> {prettyName(swap.out.name)}
                      </span>
                      <span className="swap-arrow" aria-hidden>
                        →
                      </span>
                      <span className="swap-in">
                        <span className="muted">Entra</span> {prettyName(swap.in.name)}
                        <i className="muted num">
                          {swap.in.clubShort} · {positionLabel(swap.in.position)} ·{" "}
                          {credits(swap.in.price)}
                        </i>
                      </span>
                    </div>
                    {/* La ganancia es la razón por la que se lee esta tarjeta:
                        va en grande, y el coste debajo en pequeño. */}
                    <div className="swap-gain">
                      <b className="delta-up num">{signed(swap.gain)}</b>
                      <i className="muted">pts</i>
                      <span className="num">
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
