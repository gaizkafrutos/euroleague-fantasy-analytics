"use client";

/** "Fichar" desde el mercado y la ficha, sin pasar por el buscador de Mi equipo.
 *
 *  Escribe en la misma plantilla que la consola (`localStorage["efa-squad"]`,
 *  `{ ids, coach }`). Las reglas (cuotas, presupuesto, máximo por club) las
 *  valida la consola al abrirla: aquí solo se evita pasar de diez jugadores.
 */
import { useEffect, useState } from "react";

const STORAGE_KEY = "efa-squad";
const CHANGE_EVENT = "efa-squad-change";
const SQUAD_SIZE = 10;

interface Stored {
  ids: number[];
  coach: number | null;
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ids: [], coach: null };
    const parsed = JSON.parse(raw) as Stored | number[];
    return Array.isArray(parsed) ? { ids: parsed, coach: null } : { ids: parsed.ids ?? [], coach: parsed.coach ?? null };
  } catch {
    return { ids: [], coach: null };
  }
}

function write(value: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* almacenamiento bloqueado: el botón no hace nada */
  }
}

export default function AddToSquad({
  id,
  isCoach = false,
  name,
  compact = false,
}: {
  id: number;
  isCoach?: boolean;
  name: string;
  compact?: boolean;
}) {
  const [squad, setSquad] = useState<Stored | null>(null);

  useEffect(() => {
    const sync = () => setSquad(read());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  // Antes de leer el almacenamiento no se pinta estado: evita un parpadeo de
  // "Fichar" a "En tu equipo" y un desajuste de hidratación.
  if (!squad) return <span className={`add-squad${compact ? " is-compact" : ""}`} aria-hidden />;

  const inSquad = isCoach ? squad.coach === id : squad.ids.includes(id);
  const full = !isCoach && !inSquad && squad.ids.length >= SQUAD_SIZE;

  function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const current = read();
    if (isCoach) write({ ...current, coach: current.coach === id ? null : id });
    else if (current.ids.includes(id)) write({ ...current, ids: current.ids.filter((value) => value !== id) });
    else if (current.ids.length < SQUAD_SIZE) write({ ...current, ids: [...current.ids, id] });
  }

  const label = inSquad ? `Quitar a ${name} de tu equipo` : full ? "Plantilla llena" : `Fichar a ${name}`;
  return (
    <button
      type="button"
      className={`chip add-squad${inSquad ? " is-in" : ""}${compact ? " is-compact" : ""}`}
      aria-pressed={inSquad}
      aria-label={label}
      title={full ? "Ya tienes diez jugadores: quita a alguien en Mi equipo" : label}
      disabled={full}
      onClick={toggle}
    >
      {inSquad ? "✓" : "+"}
      {compact ? null : <span>{inSquad ? " En tu equipo" : full ? " Plantilla llena" : " Fichar"}</span>}
    </button>
  );
}
