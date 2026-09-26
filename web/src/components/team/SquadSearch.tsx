"use client";

/** Fichar: buscar a un jugador concreto y meterlo en la plantilla.
 *
 *  Antes había un <select> con los 200 "mejores chollos" de los puestos que
 *  faltaban. Para fichar a alguien concreto había que saber que estaba en esa
 *  lista, y bajar por ella; y con la plantilla llena el selector se apagaba.
 *  Aquí se escribe el nombre (o el club) y sale todo el mercado.
 *
 *  Sin escribir nada, la lista enseña sugerencias para los huecos que quedan,
 *  que es lo único útil que hacía el selector antiguo.
 *
 *  Cada fila dice si se puede fichar y, si no, por qué (cupo del puesto lleno,
 *  seis del mismo club, ya en la plantilla). Lo que no bloquea pero conviene
 *  saber —pasarse del presupuesto, estar de baja— se deja fichar y se avisa:
 *  la consola es para probar plantillas, no para impedirlas.
 */
import { useId, useMemo, useRef, useState } from "react";

import Avatar from "@/components/ui/Avatar";
import { AvailabilityTag } from "@/components/ui/primitives";
import { credits, displayName, initials, normalize, num, positionLabel } from "@/lib/format";
import {
  MAX_PER_CLUB,
  QUOTA,
  SQUAD_SIZE,
  effectiveProjection,
  isSignable,
  positionWord,
  type SquadCheck,
} from "@/lib/squad";
import type { Player } from "@/lib/types";

type Filter = "all" | "G" | "F" | "C" | "E";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "G", label: "Bases" },
  { key: "F", label: "Aleros" },
  { key: "C", label: "Pívots" },
  { key: "E", label: "Entrenador" },
];

const LIMIT = 12;

interface Props {
  market: Player[];
  coaches: Player[];
  ids: number[];
  coach: Player | null;
  check: SquadCheck;
  onAdd: (id: number) => void;
}

interface Entry {
  player: Player;
  /** Nombre del censo y del mercado ("Sasha Vezenkov S. Vezenkov"). */
  name: string;
  /** Club: nombre corto, código y nombre oficial sin las palabras de relleno. */
  club: string;
}

/** "Basketball", "Basket", "BC"… aparecen en media liga: si cuentan, «bask»
 *  devuelve Dubai Basketball antes que Baskonia. */
const CLUB_FILLER = /\b(basketball|basket|bc|fc|kk|bk|sad|club)\b/g;

/** 0 = empieza palabra del nombre · 1 = del club · 2 = dentro del nombre ·
 *  3 = dentro del club · null = no coincide. */
function rank(entry: Entry, needle: string): number | null {
  const at = (hay: string) => {
    const index = hay.indexOf(needle);
    if (index === -1) return null;
    return index === 0 || hay[index - 1] === " " ? "start" : "inside";
  };
  const name = at(entry.name);
  const club = at(entry.club);
  if (name === "start") return 0;
  if (club === "start") return 1;
  if (name === "inside") return 2;
  if (club === "inside") return 3;
  return null;
}

interface Verdict {
  /** Se puede fichar. */
  ok: boolean;
  /** Por qué no, o qué conviene saber aunque se pueda. */
  note: string | null;
  /** La nota es un aviso (ámbar), no un bloqueo. */
  warn: boolean;
}

export default function SquadSearch({ market, coaches, ids, coach, check, onAdd }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");

  const index = useMemo<Entry[]>(
    () =>
      [...market, ...coaches].map((player) => ({
        player,
        name: normalize(`${displayName(player)} ${player.marketName ?? ""}`),
        club: normalize(`${player.clubShort ?? ""} ${player.club ?? ""} ${player.clubName ?? ""}`)
          .replace(CLUB_FILLER, " ")
          .replace(/\s+/g, " ")
          .trim(),
      })),
    [market, coaches],
  );

  const owned = useMemo(() => new Set(ids), [ids]);
  const full = ids.length >= SQUAD_SIZE;

  /** Huecos que quedan por puesto, en el orden del juego. */
  const missing = (Object.keys(QUOTA) as Array<keyof typeof QUOTA>)
    .map((position) => ({ position, left: QUOTA[position] - (check.counts[position] ?? 0) }))
    .filter((slot) => slot.left > 0);

  function verdict(player: Player): Verdict {
    if (player.isCoach) {
      if (coach?.id === player.id) return { ok: false, note: "Es tu entrenador", warn: false };
      return {
        ok: true,
        note: coach ? `Sustituye a ${displayName(coach)}` : null,
        warn: false,
      };
    }
    if (owned.has(player.id)) return { ok: false, note: "Ya en tu plantilla", warn: false };
    if (full) return { ok: false, note: "Plantilla completa: quita a alguien antes", warn: false };
    const position = player.position as keyof typeof QUOTA | null;
    if (position && (check.counts[position] ?? 0) >= QUOTA[position]) {
      return {
        ok: false,
        note: `Ya tienes ${QUOTA[position]} ${positionWord(position)}`,
        warn: false,
      };
    }
    if ((check.clubCounts[player.club ?? ""] ?? 0) >= MAX_PER_CLUB) {
      return {
        ok: false,
        note: `Ya tienes ${MAX_PER_CLUB} de ${player.clubShort ?? player.club}`,
        warn: false,
      };
    }
    if (player.registered === false && !player.availability) {
      return { ok: true, note: "Sin inscribir en la Euroliga", warn: true };
    }
    const over = (player.price ?? 0) - check.free;
    if (over > 0.001) return { ok: true, note: `Te pasas ${credits(over)}`, warn: true };
    return { ok: true, note: null, warn: false };
  }

  const searching = normalize(query).length >= 2;

  const results = useMemo<Player[]>(() => {
    const inFilter = (player: Player) =>
      filter === "all"
        ? true
        : filter === "E"
          ? player.isCoach
          : !player.isCoach && player.position === filter;

    if (searching) {
      const needle = normalize(query);
      const hits: Array<{ player: Player; score: number }> = [];
      for (const entry of index) {
        if (!inFilter(entry.player)) continue;
        const score = rank(entry, needle);
        if (score !== null) hits.push({ player: entry.player, score });
      }
      // Primero cómo coincide (apellido antes que club), y dentro de cada
      // grupo, el que más proyecta: buscar "Real" es para fichar, no para leer.
      return hits
        .sort(
          (a, b) =>
            a.score - b.score || (b.player.projectedFp ?? 0) - (a.player.projectedFp ?? 0),
        )
        .slice(0, LIMIT)
        .map((hit) => hit.player);
    }

    // Sin texto: sugerencias. Entrenadores por proyección; jugadores fichables
    // de los puestos que faltan (o del filtrado), por índice de chollo.
    if (filter === "E" || (filter === "all" && full && !coach)) {
      return [...coaches]
        .filter((candidate) => candidate.id !== coach?.id)
        .sort((a, b) => (b.projectedFp ?? 0) - (a.projectedFp ?? 0))
        .slice(0, 8);
    }
    const wanted = filter === "all" ? missing.map((slot) => slot.position) : [filter];
    return market
      .filter((player) => !owned.has(player.id) && isSignable(player))
      .filter((player) => !wanted.length || wanted.includes(player.position as keyof typeof QUOTA))
      .filter((player) => verdict(player).ok)
      .sort((a, b) => (b.bargainScore ?? 0) - (a.bargainScore ?? 0))
      .slice(0, 8);
    // `verdict` no va en las dependencias: lee exactamente lo que ya está en ellas.
  }, [searching, query, filter, index, market, coaches, owned, full, coach, check]);

  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  function pick(player: Player | undefined) {
    if (!player) return;
    const outcome = verdict(player);
    if (!outcome.ok) {
      setAnnounce(`${displayName(player)}: ${outcome.note ?? "no se puede fichar"}.`);
      return;
    }
    onAdd(player.id);
    setAnnounce(
      player.isCoach
        ? `${displayName(player)}, nuevo entrenador.`
        : `${displayName(player)} fichado. Quedan ${SQUAD_SIZE - ids.length - 1} plazas.`,
    );
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (query) setQuery("");
      else inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(results[activeIndex]);
    }
  }

  const caption = searching
    ? results.length
      ? `${results.length === LIMIT ? `Primeros ${LIMIT}` : results.length} de «${query.trim()}»`
      : null
    : filter === "E" || (filter === "all" && full && !coach)
      ? "Entrenadores, de más a menos proyección"
      : full
        ? null
        : filter === "all"
          ? `Para tus huecos: ${missing
              .map((slot) => `${slot.left} ${slot.left === 1 ? positionLabel(slot.position).toLowerCase() : positionWord(slot.position)}`)
              .join(" · ")}`
          : `Mejor relación precio-proyección · ${positionWord(filter)}`;

  return (
    <section className="fichar" aria-label="Fichar jugadores">
      <div className="fichar-head">
        <label className="control-label" htmlFor={`${listId}-input`}>
          Fichar
        </label>
        <span className="fichar-free num">
          {check.free >= 0 ? `${credits(check.free)} libres` : `${credits(-check.free)} de más`}
        </span>
      </div>

      <div className="fichar-box">
        <svg className="fichar-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="9" cy="9" r="5.6" stroke="currentColor" strokeWidth="1.7" />
          <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          className="fichar-input"
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? `${listId}-opt-${activeIndex}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="Nombre o club"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="fichar-filters" role="group" aria-label="Filtrar por puesto">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="chip"
            aria-pressed={filter === option.key}
            onClick={() => {
              setFilter(option.key);
              setActive(0);
            }}
          >
            {option.label}
            {option.key !== "all" && option.key !== "E" ? (
              <span className="fichar-quota num">
                {check.counts[option.key] ?? 0}/{QUOTA[option.key]}
              </span>
            ) : option.key === "E" ? (
              <span className="fichar-quota num">{coach ? 1 : 0}/1</span>
            ) : null}
          </button>
        ))}
      </div>

      {caption ? <p className="fichar-caption">{caption}</p> : null}

      {results.length ? (
        <ul className="fichar-list" id={`${listId}-list`} role="listbox" aria-label="Resultados">
          {results.map((player, position) => {
            const outcome = verdict(player);
            const isActive = position === activeIndex;
            const projection = effectiveProjection(player);
            return (
              <li
                key={player.id}
                id={`${listId}-opt-${position}`}
                role="option"
                aria-selected={isActive}
                aria-disabled={!outcome.ok}
                className={`fichar-opt pos-${player.isCoach ? "E" : (player.position ?? "X")}${
                  isActive ? " is-active" : ""
                }${outcome.ok ? "" : " is-blocked"}`}
                // mousedown y no click: así el input no pierde el foco y en el
                // móvil el teclado no se cierra entre fichaje y fichaje.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(player);
                }}
                onMouseEnter={() => setActive(position)}
              >
                {player.image ? (
                  <Avatar src={player.image} name={player.name ?? player.marketName ?? "?"} />
                ) : player.clubCrest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar avatar-crest" src={player.clubCrest} alt="" loading="lazy" />
                ) : (
                  <span className="avatar avatar-initials" aria-hidden>
                    {initials(player.name ?? player.marketName)}
                  </span>
                )}

                <span className="fichar-who">
                  <span className="fichar-name">{displayName(player)}</span>
                  <span className="fichar-meta">
                    <i className="fichar-pos" aria-hidden />
                    {player.isCoach ? "Entrenador" : positionLabel(player.position)} ·{" "}
                    {player.clubShort ?? player.club ?? "—"}
                    {player.availability ? <AvailabilityTag player={player} /> : null}
                  </span>
                  {outcome.note ? (
                    <span className={`fichar-note${outcome.warn ? " is-warn" : ""}`}>
                      {outcome.note}
                    </span>
                  ) : null}
                </span>

                <span className="fichar-figs">
                  <span className="fichar-proj num">
                    {player.projectedFp === null ? "—" : num(projection)}
                    <small>pts</small>
                  </span>
                  <span className="fichar-price num">{credits(player.price)}</span>
                </span>

                <span className="fichar-add" aria-hidden>
                  {outcome.ok ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 6v12M6 12h12" strokeLinecap="round" />
                    </svg>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : searching ? (
        <p className="fichar-empty">
          Nadie en el mercado con «{query.trim()}»
          {filter !== "all" ? ` entre los ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()}` : ""}.
        </p>
      ) : full && coach ? (
        <p className="fichar-empty">
          Plantilla completa. Quita a alguien en la cancha para hacerle hueco, o busca por nombre
          para comparar.
        </p>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}
