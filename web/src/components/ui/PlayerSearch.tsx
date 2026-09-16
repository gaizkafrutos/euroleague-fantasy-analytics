"use client";

/** Buscador de jugadores de la cabecera.
 *
 *  Antes, para ver la ficha de alguien había que bajar hasta el explorador y
 *  filtrar. En el móvil eso son dos scrolls largos y un teclado que tapa media
 *  pantalla. Aquí está siempre a un toque.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { positionLabel } from "@/lib/format";
import { searchPlayers, type SearchEntry } from "@/lib/search-index";

export default function PlayerSearch() {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<SearchEntry[]>([]);

  useEffect(() => {
    setResults(searchPlayers(query));
    setActive(0);
  }, [query]);

  /* Clic fuera: cerrar. */
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  /* "/" enfoca el buscador, como en cualquier herramienta de datos. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(entry: SearchEntry | undefined) {
    if (!entry) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(`/jugador/${entry.id}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  }

  const expanded = open && results.length > 0;

  return (
    <div className="search" ref={boxRef}>
      <svg className="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="9" cy="9" r="5.6" stroke="currentColor" strokeWidth="1.7" />
        <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls="search-results"
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="go"
        placeholder="Buscar jugador"
        aria-label="Buscar jugador"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {expanded ? (
        <ul className="search-results" id="search-results" role="listbox">
          {results.map((entry, index) => (
            <li key={entry.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? "is-active" : undefined}
                // mousedown en vez de click: si no, el blur del input cierra la
                // lista antes de que el clic llegue a registrarse.
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(entry);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="search-name">{entry.name}</span>
                <span className="search-meta">
                  {entry.club}
                  {entry.position ? ` · ${positionLabel(entry.position)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
