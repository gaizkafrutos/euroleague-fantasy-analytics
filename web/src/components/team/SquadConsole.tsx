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
import { useCallback, useEffect, useMemo, useState } from "react";

import ScoreRange from "@/components/advanced/ScoreRange";
import SquadSearch from "@/components/team/SquadSearch";
import Contribution from "@/components/team/squad/Contribution";
import SquadDiagnosis from "@/components/team/squad/SquadDiagnosis";
import { EmptySlot, Token } from "@/components/team/squad/Token";
import TradePlanPanel from "@/components/team/squad/TradePlanPanel";
import { sdOf, squadRange } from "@/lib/advanced";
import { AvailabilityTag } from "@/components/ui/primitives";
import { clubName } from "@/lib/clubs";
import { credits, displayName, num, signed } from "@/lib/format";
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
  manualRoles,
  planTrades,
  positionWord,
  rentInRole,
  scoredProjection,
  suggestSwaps,
  swapInLineup,
  toManual,
  tradeWindow,
  type ManualLineup,
  type TradePlan,
} from "@/lib/squad";
import type { Player } from "@/lib/types";

const STORAGE_KEY = "efa-squad";
/** Aparte de la plantilla: `AddToSquad` reescribe `efa-squad` con solo
 *  `{ ids, coach }` y se llevaría el presupuesto por delante. */
const BUDGET_KEY = "efa-budget";
/** La alineación elegida a mano, si la hay. Sin ella, la consola coloca sola. */
const LINEUP_KEY = "efa-lineup";

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
  // Lo que se está escribiendo en el campo, que puede estar a medias ("100,").
  const [budgetText, setBudgetText] = useState(String(DEFAULT_BUDGET));
  useEffect(() => {
    setBudgetText((text) => (Number(text.replace(",", ".")) === budget ? text : String(budget)));
  }, [budget]);
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

  /* ------------------------------------------------------ alineación a mano */
  // Quinteto y sexto puntúan igual, así que la automática ya es la mejor; pero
  // cada uno alinea como quiere (y en el juego se cambia entre turnos). Con
  // una alineación a mano, TODAS las cifras de la cancha son las de esa.
  const [manual, setManual] = useState<ManualLineup | null>(null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [lineupError, setLineupError] = useState<string | null>(null);
  const custom = useMemo(() => manualRoles(squad, manual), [squad, manual]);
  const roles = custom ?? check.roles;
  const scored = custom ? Number(scoredProjection(custom, coach).toFixed(2)) : check.scored;
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
      const lineup = window.localStorage.getItem(LINEUP_KEY);
      if (lineup) setManual(JSON.parse(lineup) as ManualLineup);
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
      if (manual) window.localStorage.setItem(LINEUP_KEY, JSON.stringify(manual));
      else window.localStorage.removeItem(LINEUP_KEY);
    } catch {
      /* idem */
    }
  }, [ids, coachId, budget, manual, restored]);

  // Si la plantilla cambia y la alineación a mano deja de cuadrar (ha salido
  // alguien de ella), se vuelve a la automática en vez de enseñar algo roto.
  useEffect(() => {
    if (restored && manual && squad.length === SQUAD_SIZE && !custom) setManual(null);
  }, [restored, manual, squad.length, custom]);

  function pick(id: number) {
    setLineupError(null);
    if (picked === null) {
      setPicked(id);
      return;
    }
    if (picked === id) {
      setPicked(null);
      return;
    }
    const result = swapInLineup(squad, manual ?? toManual(check.roles), picked, id);
    if ("error" in result) setLineupError(result.error);
    else {
      // Cada cambio suelto también se puede deshacer, no solo vaciar y rellenar.
      keepForUndo("Cambio hecho");
      setManual(result.lineup);
    }
    setPicked(null);
  }

  function makeCaptain(id: number) {
    const player = byId.get(id);
    keepForUndo(player ? `Capitán: ${displayName(player)}` : "Capitán cambiado");
    setManual({ ...(manual ?? toManual(roles)), captain: id });
  }

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
    const player = byId.get(id);
    keepForUndo(player ? `${displayName(player)}, fuera` : "Jugador quitado");
    if (id === coachId) setCoachId(null);
    else setIds((previous) => previous.filter((value) => value !== id));
  }

  function autofill() {
    keepForUndo(ids.length || coachId !== null ? "Plantilla sustituida por el óptimo" : "Óptimo aplicado", true);
    if (typeof window !== "undefined" && window.innerWidth < 760) {
      window.requestAnimationFrame(() =>
        document.getElementById("quinteto")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
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

  // Vaciar o rellenar machaca la plantilla de un toque: se guarda la anterior
  // unos segundos para poder deshacerlo.
  const [undo, setUndo] = useState<{
    message: string;
    ids: number[];
    coachId: number | null;
    manual: ManualLineup | null;
  } | null>(null);

  const [undoPaused, setUndoPaused] = useState(false);

  useEffect(() => {
    if (!undo || undoPaused) return;
    const timer = window.setTimeout(() => setUndo(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undo, undoPaused]);

  function keepForUndo(message: string, always = false) {
    if (always || ids.length || coachId !== null) setUndo({ message, ids, coachId, manual });
  }

  function restoreUndo() {
    if (!undo) return;
    setIds(undo.ids);
    setCoachId(undo.coachId);
    setManual(undo.manual);
    setUndo(null);
  }

  function clear() {
    keepForUndo("Plantilla vaciada");
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

  // La jornada se juega en varios días: las fichas llevan T1/T2/T3.
  const multiTurn = squad.some((player) => (player.schedule?.next?.turns ?? 1) > 1);

  const atOptimum =
    full && typeof optimalScored === "number" && Math.abs(scored - optimalScored) < 0.05;

  // El quinteto se coloca por puesto, no por proyección: los pívots junto al
  // aro, luego aleros, los bases al perímetro. El del medio ocupa las dos
  // columnas. El capitán lleva su marca esté donde esté.
  const courtOrder = { C: 0, F: 1, G: 2 } as Record<string, number>;
  const starters = [...roles.starters].sort(
    (a, b) => (courtOrder[a.position ?? ""] ?? 3) - (courtOrder[b.position ?? ""] ?? 3),
  );

  const search = (
    <SquadSearch
      market={market}
      coaches={coaches}
      ids={ids}
      coach={coach}
      check={check}
      onAdd={add}
    />
  );

  return (
    <div className="cancha">
      {/* ------------------------------------------------------- controles */}
      <div className="squad-controls">
        {/* Rellenar es la acción de la página: el único botón sólido. Vaciar
            es destructiva y va aparte, discreta, con deshacer. */}
        <div className="squad-actions">
          <button
            type="button"
            className="button-primary"
            onClick={autofill}
            disabled={atOptimum}
          >
            {atOptimum ? "Ya es el óptimo" : "Rellenar con el óptimo"}
          </button>
          {rosterConfigured ? (
            // Es el equipo de la cuenta configurada en el despliegue (la del autor),
            // no el de quien visita: el texto no puede prometer otra cosa.
            <button type="button" className="button-ghost" onClick={loadRoster}>
              {roster.status === "loading" ? "Cargando…" : "Cargar el equipo del autor"}
            </button>
          ) : null}
          {squad.length || coach ? (
            <button type="button" className="text-button squad-clear" onClick={clear}>
              Vaciar
            </button>
          ) : null}
        </div>
        {/* Deslizador para tantear y campo para la cifra exacta: tras la J1 el
            presupuesto de cada uno tiene decimales (100,7, por ejemplo), y
            una décima puede decidir si un jugador cabe. */}
        <div className="control squad-budget">
          <span className="control-label" id="budget-label">
            Presupuesto
          </span>
          <span className="budget-row">
            <input
              className="slider"
              type="range"
              min={80}
              max={130}
              step={0.1}
              value={budget}
              aria-labelledby="budget-label"
              onChange={(event) => setBudget(roundBudget(Number(event.target.value)))}
            />
            <input
              className="input num budget-input"
              type="number"
              inputMode="decimal"
              min={50}
              max={200}
              step={0.1}
              value={budgetText}
              aria-label="Presupuesto en créditos"
              onChange={(event) => {
                setBudgetText(event.target.value);
                const value = Number(event.target.value.replace(",", "."));
                if (Number.isFinite(value) && value >= 50 && value <= 200) setBudget(roundBudget(value));
              }}
              onBlur={() => setBudgetText(String(budget))}
            />
          </span>
        </div>
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
                if (Number.isFinite(cash) && cash >= 0) setBudget(roundBudget(check.spent + cash));
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

      {/* ------------------------------------------------------- horquilla
          Lo primero tras los controles: es la lectura que manda. Las cuatro
          cifras de debajo la matizan. */}
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
          <dd className="num">{num(scored)}</dd>
          <dd className="dl-note">
            {custom && Math.abs(scored - check.scored) > 0.005
              ? `tu alineación · la mejor da ${num(check.scored)}`
              : "con capitán ×2 y banquillo ×0,5"}
          </dd>
        </div>
        <div>
          {full && typeof optimalScored === "number" ? (
            <>
              <dt>Frente al óptimo</dt>
              {/* A la par del óptimo no es una subida: sin color. */}
              <dd
                className={`num ${
                  Math.abs(scored - optimalScored) < 0.05
                    ? ""
                    : scored > optimalScored
                      ? "delta-up"
                      : "delta-down"
                }`}
              >
                {signed(scored - optimalScored)}
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
          <dd className="dl-note">{topClub ? clubName(topClub[0]) : "—"}</dd>
        </div>
      </dl>

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

      {/* ---------------------------------------------------------- fichar
          Mientras faltan huecos, fichar es lo primero. Con la plantilla
          completa manda el equipo y el buscador baja (sirve para comparar). */}
      {full ? null : search}

      {squad.length || coach ? (
        <>
          {/* ----------------------------------------------------- la pista */}
          <div className="bench-head court-head">
            <h2 id="quinteto">Quinteto</h2>
            {roles.starters.length === STARTERS ? (
              <span className="bench-tag num">{formationOf(roles.starters)}</span>
            ) : null}
            <p>
              Al menos uno de cada puesto: 2-2-1, 1-2-2, 2-1-2, 1-3-1 o 3-1-1.
              {multiTurn ? " T1, T2 y T3: el día de la jornada en que juega cada uno." : null}
            </p>
            {squad.length === SQUAD_SIZE ? (
              <div className="lineup-tools">
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    setEditing((value) => !value);
                    setPicked(null);
                    setLineupError(null);
                  }}
                >
                  {editing ? "Listo" : "Colocar a mano"}
                </button>
                {custom ? (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      keepForUndo("Alineación automática");
                      setManual(null);
                      setPicked(null);
                      setLineupError(null);
                    }}
                  >
                    Volver a la automática
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {editing ? (
            <p className="lineup-help" role="status">
              {picked !== null
                ? "Ahora toca a quien ocupa el sitio al que quieres llevarlo."
                : "Toca un jugador y luego otro para intercambiar sus sitios (quinteto, sexto o banquillo). La «C» de un titular lo hace capitán."}
              {custom && Math.abs(scored - check.scored) > 0.005
                ? ` Tu alineación da ${num(scored)}; la mejor, ${num(check.scored)} (${signed(scored - check.scored)}).`
                : ""}
            </p>
          ) : null}
          {lineupError ? (
            <p className="lineup-error" role="alert">
              {lineupError}
            </p>
          ) : null}
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
                    edit={editing ? { picked: picked === player.id, onPick: pick, onCaptain: makeCaptain } : null}
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
                  edit={editing ? { picked: picked === roles.sixth.id, onPick: pick } : null}
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
                    edit={editing ? { picked: picked === player.id, onPick: pick } : null}
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

          {full ? <Contribution roles={roles} scored={scored} coach={coach} /> : null}
        </>
      ) : (
        <p className="muted cancha-empty">
          {rosterConfigured
            ? "Busca y ficha jugadores arriba, carga el equipo del autor o deja que lo rellene el optimizador."
            : "Busca y ficha jugadores arriba o deja que lo rellene el optimizador."}
        </p>
      )}

      {/* -------------------------------------------------- plan de cambios */}
      {full ? (
        <TradePlanPanel
          round={round}
          tradeWin={tradeWin}
          tradeLimit={tradeLimit}
          onTradeLimit={setTradeLimit}
          overBudget={check.free < -1e-6}
          planning={planning}
          plan={plan}
          budget={budget}
          onApply={applyPlan}
        />
      ) : null}

      {/* ----------------------------------------------------- diagnóstico */}
      {squad.length ? (
        <SquadDiagnosis weakest={weakest} swaps={swaps} roles={roles} free={check.free} />
      ) : null}

      {full ? search : null}

      <div className="toast-region" aria-live="polite">
        {undo ? (
          <div
            className="toast"
            onPointerEnter={() => setUndoPaused(true)}
            onPointerLeave={() => setUndoPaused(false)}
            onFocus={() => setUndoPaused(true)}
            onBlur={() => setUndoPaused(false)}
          >
            <span>{undo.message}</span>
            <button type="button" onClick={restoreUndo}>
              Deshacer
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Los créditos del juego van en décimas: 100,70000000001 es 100,7. */
function roundBudget(value: number): number {
  return Math.round(value * 10) / 10;
}
