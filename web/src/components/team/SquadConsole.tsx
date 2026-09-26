"use client";

/** Consola de equipo, sobre la cancha.
 *
 *  Dos modos, uno solo de código:
 *   - conectado: si el despliegue tiene token, precarga el roster real.
 *   - manual: cualquiera puede armar los once y recibir el mismo análisis.
 *
 *  Esto último no es un adorno: una página que solo funciona para el dueño del
 *  token es inútil para quien abre el enlace desde fuera.
 *
 *  Antes la plantilla era una tabla de diez filas iguales. Pero en el juego no
 *  son iguales: cinco al quinteto, uno de sexto hombre, cuatro al banquillo a
 *  la mitad y un entrenador. La cancha dibuja eso, y cada cifra que se enseña
 *  es la que de verdad puntúa en su sitio.
 *
 *  Los colores de las placas codifican PUESTO, no club: con once clubes en
 *  pantalla, los colores de club colapsan (siete comparten casi el mismo rojo).
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import ScoreRange from "@/components/advanced/ScoreRange";
import SquadSearch from "@/components/team/SquadSearch";
import { sdOf, squadRange } from "@/lib/advanced";
import { AvailabilityTag, Delta, PlayerCell } from "@/components/ui/primitives";
import { credits, displayName, num, percent, positionLabel, signed } from "@/lib/format";
import { fixtureLabel, playRisk, turnLabel } from "@/lib/projection";
import {
  DEFAULT_BUDGET,
  MAX_PER_CLUB,
  QUOTA,
  SQUAD_SIZE,
  STARTERS,
  TRADES_PER_ROUND,
  buildSquad,
  checkSquad,
  effectiveProjection,
  extractRosterIds,
  formationOf,
  planTrades,
  positionWord,
  rentInRole,
  roleMultiplier,
  suggestSwaps,
  tradeWindow,
  type TradePlan,
} from "@/lib/squad";
import type { Player } from "@/lib/types";

const STORAGE_KEY = "efa-squad";
/** Aparte de la plantilla: `AddToSquad` reescribe `efa-squad` con solo
 *  `{ ids, coach }` y se llevaría el presupuesto por delante. */
const BUDGET_KEY = "efa-budget";

interface Props {
  market: Player[];
  coaches: Player[];
  /** El óptimo exacto del pipeline para 100 créditos, si lo hay. */
  optimal?: { playerIds: number[]; coachId: number | null; scored: number | null } | null;
  /** Próxima jornada por jugar y jornadas de la fase regular: deciden si hay
   *  cuatro cambios o ventana ilimitada. */
  round: number;
  regularRounds: number;
  /** Si el despliegue tiene token y equipo configurados. Sin ellos el botón de
   *  cargar equipo solo servía para enseñar un aviso técnico a cada visitante. */
  rosterConfigured?: boolean;
}

type RosterState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; count: number };

interface Stored {
  ids: number[];
  coach: number | null;
}

export default function SquadConsole({
  market,
  coaches,
  optimal,
  round,
  regularRounds,
  rosterConfigured = false,
}: Props) {
  const [ids, setIds] = useState<number[]>([]);
  const [coachId, setCoachId] = useState<number | null>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [roster, setRoster] = useState<RosterState>({ status: "idle" });
  const [restored, setRestored] = useState(false);

  const byId = useMemo(
    () => new Map([...market, ...coaches].map((player) => [player.id, player])),
    [market, coaches],
  );
  const known = useMemo(() => new Set(byId.keys()), [byId]);

  const squad = useMemo(
    () => ids.map((id) => byId.get(id)).filter((player): player is Player => Boolean(player)),
    [ids, byId],
  );
  const coach = coachId !== null ? (byId.get(coachId) ?? null) : null;

  const check = useMemo(() => checkSquad(squad, budget, coach), [squad, budget, coach]);
  const { roles } = check;
  const swaps = useMemo(
    () => (squad.length ? suggestSwaps(squad, market, budget, coach, 5, coaches) : []),
    [squad, market, budget, coach, coaches],
  );

  // Lo que aporta cada crédito en el sitio que ocupa: el capitán cuenta doble y
  // el banquillo la mitad. Un jugador de baja rinde 0 y va el primero.
  const weakest = useMemo(
    () =>
      [...squad]
        .filter((player) => (player.price ?? 0) > 0)
        .sort((a, b) => rentInRole(roles, a) - rentInRole(roles, b))
        .slice(0, 3),
    [squad, roles],
  );

  /* ------------------------------------------------------- plan de cambios */
  const tradeWin = useMemo(() => tradeWindow(round, regularRounds), [round, regularRounds]);
  const [tradeLimit, setTradeLimit] = useState<number>(TRADES_PER_ROUND);
  const [plan, setPlan] = useState<TradePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const full = squad.length >= SQUAD_SIZE && coach !== null;
  const limit = tradeWin.unlimited ? Infinity : tradeLimit;
  useEffect(() => {
    // El plan cuesta de 50 a 600 ms: se calcula después de pintar, y solo con
    // la plantilla completa y dentro del presupuesto.
    if (!full || check.free < -1e-6) {
      setPlan(null);
      return;
    }
    setPlanning(true);
    const timer = setTimeout(() => {
      setPlan(planTrades({ players: squad, coach }, market, coaches, budget, limit));
      setPlanning(false);
    }, 30);
    return () => clearTimeout(timer);
  }, [full, squad, coach, market, coaches, budget, limit, check.free]);

  function applyPlan() {
    if (!plan) return;
    setIds(plan.players.map((player) => player.id));
    setCoachId(plan.coach?.id ?? null);
  }

  // Horquilla de la jornada: cada jugador con su multiplicador real.
  const range = useMemo(() => {
    if (!squad.length) return null;
    const entries = [
      ...roles.starters.map((player) => ({
        player,
        multiplier: player.id === roles.captain?.id ? 2 : 1,
      })),
      ...(roles.sixth ? [{ player: roles.sixth, multiplier: 1 }] : []),
      ...roles.bench.map((player) => ({ player, multiplier: 0.5 })),
      ...(coach ? [{ player: coach, multiplier: 1 }] : []),
    ].map(({ player, multiplier }) => {
      const mean = effectiveProjection(player);
      return { multiplier, mean, sd: sdOf(player, mean) };
    });
    return squadRange(entries);
  }, [squad.length, roles, coach]);

  const topClub = useMemo(() => {
    const entries = Object.entries(check.clubCounts).sort((a, b) => b[1] - a[1]);
    return entries[0] ?? null;
  }, [check.clubCounts]);

  /* ------------------------------------------------------------ persistencia */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored | number[];
        // Versión anterior: un array de diez ids, sin entrenador.
        if (Array.isArray(parsed)) setIds(parsed);
        else {
          setIds(parsed.ids ?? []);
          setCoachId(parsed.coach ?? null);
        }
      }
    } catch {
      /* almacenamiento bloqueado o corrupto: se empieza de cero */
    }
    try {
      const stored = Number(window.localStorage.getItem(BUDGET_KEY));
      if (stored >= 50 && stored <= 200) setBudget(stored);
    } catch {
      /* idem */
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    // Sin esta guarda, el primer render (vacío) machacaría lo guardado antes
    // de que se llegue a leer.
    if (!restored) return;
    try {
      const value: Stored = { ids, coach: coachId };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      window.localStorage.setItem(BUDGET_KEY, String(budget));
    } catch {
      /* idem */
    }
  }, [ids, coachId, budget, restored]);

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
      const foundPlayers = found.filter((id) => !byId.get(id)?.isCoach);
      const foundCoach = found.find((id) => byId.get(id)?.isCoach) ?? null;
      setIds(foundPlayers.slice(0, SQUAD_SIZE));
      setCoachId(foundCoach);
      setRoster({ status: "ready", count: found.length });
    } catch (error) {
      setRoster({ status: "error", message: (error as Error).message });
    }
  }, [known, byId]);

  function add(id: number) {
    const player = byId.get(id);
    if (!player) return;
    if (player.isCoach) {
      setCoachId(id);
    } else {
      if (ids.includes(id) || ids.length >= SQUAD_SIZE) return;
      setIds((previous) => [...previous, id]);
    }
  }

  function remove(id: number) {
    if (id === coachId) setCoachId(null);
    else setIds((previous) => previous.filter((value) => value !== id));
  }

  function autofill() {
    // Con 100 créditos se carga el óptimo exacto que resolvió el pipeline por
    // programación entera: el mismo que enseña el mercado. Con otro
    // presupuesto, la aproximación voraz de squad.ts.
    if (optimal && budget === DEFAULT_BUDGET && optimal.playerIds.length === SQUAD_SIZE) {
      setIds(optimal.playerIds);
      setCoachId(optimal.coachId);
      return;
    }
    const built = buildSquad(market, budget, coaches);
    setIds(built.players.map((player) => player.id));
    setCoachId(built.coach?.id ?? null);
  }

  function clear() {
    setIds([]);
    setCoachId(null);
  }

  // El óptimo con TU presupuesto: el del pipeline es a 100 créditos, y pasada
  // la J1 casi nadie tiene 100. Con otro presupuesto se calcula aquí (voraz +
  // búsqueda local, a menos de medio punto del exacto en las pruebas).
  const optimalScored = useMemo(() => {
    if (Math.abs(budget - DEFAULT_BUDGET) < 1e-9) return optimal?.scored ?? null;
    if (!full) return null;
    const built = buildSquad(market, budget, coaches);
    return built.players.length === SQUAD_SIZE ? checkSquad(built.players, budget, built.coach).scored : null;
  }, [budget, full, optimal, market, coaches]);

  // El quinteto se coloca por puesto, no por proyección: los pívots junto al
  // aro, luego aleros, los bases al perímetro. El del medio ocupa las dos
  // columnas. El capitán lleva su marca esté donde esté.
  const courtOrder = { C: 0, F: 1, G: 2 } as Record<string, number>;
  const starters = [...roles.starters].sort(
    (a, b) => (courtOrder[a.position ?? ""] ?? 3) - (courtOrder[b.position ?? ""] ?? 3),
  );

  return (
    <div className="cancha">
      {/* ------------------------------------------------------- controles */}
      <div className="squad-controls">
        {rosterConfigured ? (
          // Es el equipo de la cuenta configurada en el despliegue (la del autor),
          // no el de quien visita: el texto no puede prometer otra cosa.
          <button type="button" className="chip" onClick={loadRoster}>
            {roster.status === "loading" ? "Cargando…" : "Cargar el equipo del autor"}
          </button>
        ) : null}
        <button type="button" className="chip" onClick={autofill}>
          Rellenar con el óptimo
        </button>
        <button type="button" className="chip" onClick={clear}>
          Vaciar
        </button>
        <label className="control squad-budget">
          <span className="control-label">Presupuesto · {credits(budget)}</span>
          <input
            className="slider"
            type="range"
            min={80}
            max={130}
            step={0.1}
            value={budget}
            onChange={(event) => setBudget(Number(event.target.value))}
          />
        </label>
        {/* Pasada la J1 el presupuesto de cada uno ya no es 100: es lo que vale
            su plantilla hoy más lo que tiene en caja. El juego enseña la caja;
            con ella, la cuenta sale sola. */}
        {squad.length ? (
          <label className="control squad-cash">
            <span className="control-label">En caja</span>
            <input
              className="input num"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={0}
              value={Number(Math.max(check.free, 0).toFixed(1))}
              onChange={(event) => {
                const cash = Number(event.target.value);
                if (Number.isFinite(cash) && cash >= 0) setBudget(Number((check.spent + cash).toFixed(1)));
              }}
              title="Los créditos que te quedan en el juego. Tu presupuesto es lo que vale tu plantilla hoy más esto."
            />
          </label>
        ) : null}
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

      {/* ---------------------------------------------------------- cifras */}
      <dl className="cancha-figures">
        <div className="is-credit">
          <dt>Gastado</dt>
          <dd className="num">
            {num(check.spent)}
            <em>/{num(budget, Number.isInteger(budget) ? 0 : 1)}</em>
          </dd>
          <dd className="num dl-note">
            {check.free >= 0 ? `${credits(check.free)} libres` : `${credits(-check.free)} de más`}
          </dd>
        </div>
        <div>
          <dt>Proyección real</dt>
          <dd className="num">{num(check.scored)}</dd>
          <dd className="dl-note">con capitán ×2 y banquillo ×0,5</dd>
        </div>
        <div>
          {full && typeof optimalScored === "number" ? (
            <>
              <dt>Frente al óptimo</dt>
              <dd
                className={`num ${check.scored >= optimalScored - 0.05 ? "delta-up" : "delta-down"}`}
              >
                {signed(check.scored - optimalScored)}
              </dd>
              <dd className="num dl-note">respecto a los {num(optimalScored)} del óptimo con {credits(budget)}</dd>
            </>
          ) : (
            <>
              <dt>Plantilla</dt>
              <dd className="num">
                {squad.length + (coach ? 1 : 0)}
                <em>/11</em>
              </dd>
              <dd className="dl-note">
                {(Object.keys(QUOTA) as Array<keyof typeof QUOTA>)
                  .map(
                    (position) =>
                      `${check.counts[position] ?? 0}/${QUOTA[position]} ${positionWord(position)}`,
                  )
                  .join(" · ")}
                {coach ? "" : " · sin entrenador"}
              </dd>
            </>
          )}
        </div>
        <div>
          <dt>Del mismo club</dt>
          <dd className="num">
            {topClub ? topClub[1] : 0}
            <em>máx. {MAX_PER_CLUB}</em>
          </dd>
          <dd className="dl-note">{topClub ? topClub[0] : "—"}</dd>
        </div>
      </dl>

      {range && squad.length >= 5 ? (
        <section className="cancha-range" aria-labelledby="horquilla">
          <div className="cancha-section-head">
            <h2 id="horquilla">Horquilla de la jornada</h2>
            <p>
              La proyección es una media; la jornada, una tirada. Cada jugador con su dispersión
              y su multiplicador.
            </p>
          </div>
          <ScoreRange
            range={range}
            optimal={full ? optimalScored : null}
          />
        </section>
      ) : null}

      {check.problems.length ? (
        <ul className="notice cancha-problems">
          {check.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {check.alerts.length ? (
        <ul className="notice cancha-alerts" aria-label="Avisos de disponibilidad">
          {check.alerts.map((player) => (
            <li key={player.id}>
              <AvailabilityTag player={player} />
              <b>{displayName(player)}</b>
              <span>
                {player.availability?.label}
                {player.availability?.level === "out" ? ": esta jornada cuenta como 0." : "."}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---------------------------------------------------------- fichar */}
      <SquadSearch
        market={market}
        coaches={coaches}
        ids={ids}
        coach={coach}
        check={check}
        onAdd={add}
      />

      {squad.length || coach ? (
        <>
          {/* ----------------------------------------------------- la pista */}
          <div className="bench-head court-head">
            <h2>Quinteto</h2>
            {roles.starters.length === STARTERS ? (
              <span className="bench-tag num">{formationOf(roles.starters)}</span>
            ) : null}
            <p>
              Bases, aleros y pívots en pista. El reglamento solo admite 2-2-1, 1-2-2, 2-1-2,
              1-3-1 y 3-1-1: siempre al menos uno de cada puesto.
            </p>
          </div>
          <section className="court" aria-label="Quinteto">
            <svg
              className="court-lines"
              viewBox="0 0 400 300"
              preserveAspectRatio="none"
              aria-hidden
            >
              <rect x="0.5" y="0.5" width="399" height="299" rx="6" />
              <rect x="150" y="0" width="100" height="86" />
              <circle cx="200" cy="86" r="30" />
              <path d="M40 0 L40 44 A170 170 0 0 0 360 44 L360 0" />
              <line x1="178" y1="10" x2="222" y2="10" />
            </svg>
            <div className="court-grid">
              {Array.from({ length: STARTERS }, (_, index) => {
                const player = starters[index];
                const mid = index === 2 ? " slot-mid" : "";
                return player ? (
                  <Token
                    key={player.id}
                    player={player}
                    role={player.id === roles.captain?.id ? "captain" : "starter"}
                    onRemove={remove}
                    className={mid}
                  />
                ) : (
                  <EmptySlot key={`vacio-${index}`} label="Quinteto" className={mid} />
                );
              })}
            </div>
          </section>

          <section className="bench-row">
            <div className="bench-head">
              <h2>Sexto hombre</h2>
              <span className="bench-tag">100 % de sus puntos</span>
              <p>Puntúa igual que un titular; solo el capitán tiene que salir del quinteto.</p>
            </div>
            <div className="bench-grid is-single">
              {roles.sixth ? (
                <Token
                  player={roles.sixth}
                  role="sixth"
                  onRemove={remove}
                />
              ) : (
                <EmptySlot label="Sexto hombre" />
              )}
            </div>
          </section>

          <section className="bench-row">
            <div className="bench-head">
              <h2>Banquillo</h2>
              <span className="bench-tag is-half">50 % de sus puntos</span>
              <p>Aquí no se gasta: cada crédito rinde la mitad.</p>
            </div>
            <div className="bench-grid">
              {Array.from({ length: SQUAD_SIZE - STARTERS - 1 }, (_, index) => {
                const player = roles.bench[index];
                return player ? (
                  <Token
                    key={player.id}
                    player={player}
                    role="bench"
                    onRemove={remove}
                  />
                ) : (
                  <EmptySlot key={`banco-${index}`} label="Banquillo" />
                );
              })}
            </div>
          </section>

          <section className="bench-row">
            <div className="bench-head">
              <h2>Entrenador</h2>
              <span className="bench-tag">100 % de sus puntos</span>
              <p>Obligatorio. Puntúa por el resultado de su equipo, y puede restar.</p>
            </div>
            <div className="bench-grid is-single">
              {coach ? (
                <Token
                  player={coach}
                  role="coach"
                  onRemove={remove}
                />
              ) : (
                <EmptySlot label="Entrenador" />
              )}
            </div>
          </section>

          {full ? <Contribution check={check} coach={coach} /> : null}
        </>
      ) : (
        <p className="muted cancha-empty">
          Busca y ficha jugadores arriba, carga tu equipo real o deja que lo rellene el
          optimizador.
        </p>
      )}

      {/* -------------------------------------------------- plan de cambios */}
      {full ? (
        <section className="cancha-section" aria-labelledby="plan-cambios">
          <div className="cancha-section-head">
            <h2 id="plan-cambios">Plan de cambios para la J{round}</h2>
            <p>
              {tradeWin.unlimited
                ? "Ventana de cambios ilimitados: el plan lleva tu plantilla hasta lo mejor que cabe en tu presupuesto."
                : `Hasta ${TRADES_PER_ROUND} cambios por jornada, y el entrenador cuenta como uno. ${
                    tradeWin.nextUnlimitedAfter
                      ? `La próxima ventana ilimitada se abre tras la J${tradeWin.nextUnlimitedAfter}.`
                      : ""
                  }`}
            </p>
          </div>
          <div className="cancha-panel">
            {tradeWin.unlimited ? null : (
              <div className="segmented plan-limit" role="group" aria-label="Cambios que quieres hacer">
                {[1, 2, 3, 4].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={tradeLimit === value}
                    onClick={() => setTradeLimit(value)}
                  >
                    {value} {value === 1 ? "cambio" : "cambios"}
                  </button>
                ))}
              </div>
            )}
            {check.free < -1e-6 ? (
              <p className="muted" style={{ margin: 0 }}>
                Te pasas del presupuesto: ajústalo (o pon lo que tienes en caja) para planificar.
              </p>
            ) : planning && !plan ? (
              <p className="muted" style={{ margin: 0 }}>
                Calculando…
              </p>
            ) : plan && plan.steps.length ? (
              <>
                <ol className="plan-steps">
                  {plan.steps.map((step, index) => (
                    <li key={index}>
                      <div>
                        {step.trades.map((trade) => (
                          <div key={`${trade.out.id}-${trade.in.id}`} className="plan-trade">
                            <span className="muted">Sale</span> {displayName(trade.out)}{" "}
                            <span aria-hidden>→</span> <span className="muted">entra</span>{" "}
                            <b>{displayName(trade.in)}</b>
                            <i className="muted num">
                              {" "}
                              {trade.in.isCoach ? "entrenador" : positionLabel(trade.in.position)} ·{" "}
                              {credits(trade.in.price)} ({signed(trade.costDelta)} cr)
                            </i>
                          </div>
                        ))}
                        {step.trades.length > 1 ? (
                          <small className="muted">Van juntos: uno libera el dinero del otro.</small>
                        ) : null}
                      </div>
                      <span className="plan-gain num">
                        <b className="delta-up">{signed(step.gain)}</b>
                        <i className="muted">→ {num(step.scored)}</i>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="plan-summary">
                  <span className="num">
                    {num(plan.before)} → <b>{num(plan.after)}</b> pts ({signed(plan.after - plan.before)}) con{" "}
                    {plan.used} {plan.used === 1 ? "cambio" : "cambios"} · te quedan{" "}
                    {credits(budget - plan.spent)}
                  </span>
                  <button type="button" className="chip" onClick={applyPlan}>
                    Aplicar el plan
                  </button>
                </div>
                <p className="card-note" style={{ margin: 0 }}>
                  Ordenados por lo que ganan y en un orden que siempre cabe en la caja. Cada cifra
                  recoloca capitán, quinteto y banquillo tras el cambio. Búsqueda local contrastada
                  con el óptimo exacto: igual en 26 de 30 plantillas de prueba, 0,1 puntos por
                  debajo de media.
                </p>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Con {tradeWin.unlimited ? "cambios ilimitados" : `${tradeLimit} ${tradeLimit === 1 ? "cambio" : "cambios"}`}{" "}
                no hay nada que mejore tu plantilla dentro del presupuesto.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* ----------------------------------------------------- diagnóstico */}
      {squad.length ? (
        <div className="grid grid-2 cancha-diagnosis">
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Lo que menos te renta</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Puntos que aporta cada crédito en el sitio que ocupa: el capitán cuenta doble y
                  el banquillo la mitad. Un titular caro que proyecta poco sale aquí antes que un
                  suplente barato.
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
                      {num(rentInRole(roles, player), 2)}
                      <span className="muted" style={{ fontSize: "0.7em", fontWeight: 500 }}>
                        {" "}
                        pts/cr{" "}
                        {roleMultiplier(roles, player) === 0.5
                          ? "· banquillo"
                          : roleMultiplier(roles, player) === 2
                            ? "· capitán"
                            : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Sin precios para valorar el rendimiento.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Fichajes que caben</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Mejor recambio por puesto (entrenador incluido) dentro de tus{" "}
                  {credits(Math.max(check.free, 0))} libres más lo que recuperas al vender. La
                  ganancia es la real: si el fichaje acaba en el banquillo, suma la mitad. Nunca
                  propone a nadie de baja o sin inscribir.
                </p>
              </div>
            </div>
            {swaps.length ? (
              <ul className="swap-list">
                {swaps.map((swap) => (
                  <li key={`${swap.out.id}-${swap.in.id}`}>
                    <div className="swap-move">
                      <span className="swap-out">
                        <span className="muted">Sale</span> {displayName(swap.out)}
                        {swap.out.availability?.level === "out" ? (
                          <AvailabilityTag player={swap.out} />
                        ) : null}
                      </span>
                      <span className="swap-arrow" aria-hidden>
                        →
                      </span>
                      <span className="swap-in">
                        <span className="muted">Entra</span> {displayName(swap.in)}
                        <i className="muted num">
                          {swap.in.clubShort} · {positionLabel(swap.in.position)} ·{" "}
                          {credits(swap.in.price)}
                        </i>
                        {swap.risky ? <AvailabilityTag player={swap.in} full /> : null}
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

/* ------------------------------------------------------------------ piezas */

type TokenRole = "captain" | "starter" | "sixth" | "bench" | "coach";

function Token({
  player,
  role,
  onRemove,
  className = "",
}: {
  player: Player;
  role: TokenRole;
  onRemove: (id: number) => void;
  className?: string;
}) {
  const next = player.schedule?.next ?? null;
  const turn = turnLabel(next);
  const risk = playRisk(player);
  const name = displayName(player);
  const surname = name.includes(" ") ? name.slice(name.indexOf(" ") + 1) : name;
  // Si la foto no carga, el escudo; si tampoco, el hueco limpio. Antes se veía
  // el icono de imagen rota del navegador en mitad de la cancha.
  const [photoBroken, setPhotoBroken] = useState(false);
  const [crestBroken, setCrestBroken] = useState(false);
  const projection = player.projectedFp === null ? null : effectiveProjection(player);
  const shown =
    projection === null
      ? null
      : role === "captain"
        ? projection * 2
        : role === "bench"
          ? projection / 2
          : projection;
  const isCoach = role === "coach";
  const sub = [
    isCoach ? "Entrenador" : positionLabel(player.position),
    next ? fixtureLabel(next) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`tok pos-${isCoach ? "E" : (player.position ?? "X")}${
        role === "bench" ? " is-bench" : ""
      }${isCoach ? " is-coach" : ""}${player.availability?.level === "out" ? " is-out" : ""}${className}`}
    >
      {role === "captain" ? <span className="cap-badge">Capitán ×2</span> : null}
      <button
        type="button"
        className="tok-remove"
        onClick={() => onRemove(player.id)}
        aria-label={`Quitar a ${name}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M7 7l10 10M17 7 7 17" strokeLinecap="round" />
        </svg>
      </button>

      <div className="tok-shot">
        {player.image && !photoBroken ? (
          <Image
            src={player.image}
            alt=""
            width={750}
            height={1000}
            sizes="100px"
            onError={() => setPhotoBroken(true)}
          />
        ) : player.clubCrest && !crestBroken ? (
          <Image
            className="tok-shot-crest"
            src={player.clubCrest}
            alt=""
            width={42}
            height={42}
            onError={() => setCrestBroken(true)}
          />
        ) : null}
      </div>

      <div className="tok-plate">
        <div className="tok-name">
          {player.clubCrest ? (
            <Image className="tok-crest" src={player.clubCrest} alt="" width={15} height={15} />
          ) : null}
          {isCoach ? (
            <span title={name}>{surname}</span>
          ) : (
            <Link href={`/jugador/${player.id}`} title={name}>
              {surname}
            </Link>
          )}
        </div>
        <div className="tok-sub">
          {sub}
          {turn ? (
            <span className="turn-tag" title={`Juega en el turno ${next?.turn} de ${next?.turns}`}>
              {turn}
            </span>
          ) : null}
        </div>
        {player.availability ? (
          <div className="tok-avail">
            <AvailabilityTag player={player} />
          </div>
        ) : null}
        <div className="tok-figs">
          <span
            className="tok-proj num"
            title={
              risk !== null && typeof player.projectedIfPlays === "number"
                ? `Si juega, ${num(player.projectedIfPlays)}; ${percent(risk)} de que juegue`
                : undefined
            }
          >
            {num(shown)}
            {risk !== null ? <small className="play-risk">{percent(risk)}</small> : null}
          </span>
          <span className="tok-price num">{credits(player.price)}</span>
        </div>
        {projection !== null && role === "captain" ? (
          <span className="tok-half num">{num(projection)} × 2</span>
        ) : null}
        {projection !== null && role === "bench" ? (
          <span className="tok-half num">{num(projection)} × 0,5</span>
        ) : null}
      </div>
    </div>
  );
}

function EmptySlot({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`tok is-empty${className}`}>
      <div className="tok-shot" aria-hidden />
      <div className="tok-plate">
        <div className="tok-name">
          <span>Hueco libre</span>
        </div>
        <div className="tok-sub">{label}</div>
      </div>
    </div>
  );
}

/** De dónde sale la proyección real: una barra de parte-todo, cinco tramos.
 *  La rampa es ordinal (del capitán, que más aporta por jugador, al banquillo)
 *  y va en un solo tono; el entrenador, que es otra cosa, va en neutro. */
function Contribution({
  check,
  coach,
}: {
  check: ReturnType<typeof checkSquad>;
  coach: Player | null;
}) {
  const { roles } = check;
  const p = effectiveProjection;
  const captainPts = p(roles.captain) * 2;
  const restPts = roles.starters
    .filter((player) => player.id !== roles.captain?.id)
    .reduce((sum, player) => sum + p(player), 0);
  const sixthPts = p(roles.sixth);
  const benchRaw = roles.bench.reduce((sum, player) => sum + p(player), 0);
  const benchPts = benchRaw / 2;
  const coachPts = p(coach);
  const benchCredits = roles.bench.reduce((sum, player) => sum + (player.price ?? 0), 0);

  const segments = [
    {
      key: "s1",
      label: "Capitán ×2",
      value: captainPts,
      note: roles.captain ? displayName(roles.captain) : "",
    },
    {
      key: "s2",
      label: "Resto del quinteto",
      value: restPts,
      note: `${Math.max(roles.starters.length - 1, 0)} jugadores`,
    },
    {
      key: "s3",
      label: "Sexto hombre",
      value: sixthPts,
      note: roles.sixth ? displayName(roles.sixth) : "",
    },
    { key: "s4", label: "Banquillo ×0,5", value: benchPts, note: `de ${num(benchRaw)} brutos` },
    { key: "s5", label: "Entrenador", value: coachPts, note: coach ? displayName(coach) : "" },
  ];
  // Una barra apilada no sabe pintar negativos: un entrenador que proyecta
  // restar sale de la barra y se dice en la leyenda.
  const drawn = segments.filter((segment) => segment.value > 0);
  const summary = segments.map((segment) => `${segment.label} ${num(segment.value)}`).join("; ");

  return (
    <section className="cancha-section">
      <div className="cancha-section-head">
        <h2>De dónde salen los {num(check.scored)}</h2>
        <p>Proporciones reales sobre el total proyectado.</p>
      </div>
      <div className="cancha-panel">
        <div className="cancha-stack" role="img" aria-label={summary}>
          {drawn.map((segment) => (
            <span key={segment.key} className={segment.key} style={{ flex: segment.value }} />
          ))}
        </div>
        <div className="cancha-legend">
          {segments.map((segment) => (
            <div key={segment.key}>
              <i className={segment.key} aria-hidden />
              {segment.label} <b className="num">{num(segment.value)}</b>
              {segment.note ? <small>{segment.note}</small> : null}
            </div>
          ))}
        </div>
        <p className="cancha-callout">
          El banquillo se lleva <strong>{num(benchCredits)} créditos</strong> y devuelve{" "}
          <strong>{num(benchPts)} puntos</strong>, porque puntúa a la mitad.
          {benchCredits > 0 ? (
            <>
              {" "}
              Cada crédito ahí rinde {num(benchPts / benchCredits, 2)}; en los seis que puntúan
              enteros,{" "}
              {num(
                (captainPts + restPts + sixthPts) /
                  Math.max(
                    [...roles.starters, roles.sixth].reduce(
                      (sum, player) => sum + (player?.price ?? 0),
                      0,
                    ),
                    1,
                  ),
                2,
              )}
              .
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
