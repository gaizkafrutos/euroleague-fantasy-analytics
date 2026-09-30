/** Búsqueda del buscador de la cabecera, sin datos dentro.
 *
 *  El índice lo construye el servidor (`search-index.ts`) y llega como prop:
 *  si este módulo importara `lib/data`, el bundle de cliente de TODAS las
 *  páginas cargaría `players.json` entero (702 KB), que es lo que pasaba.
 */
import { normalize } from "./format";

export interface SearchEntry {
  id: number;
  name: string;
  club: string;
  position: string | null;
  /** Nombre + club sin acentos, en minúscula. */
  haystack: string;
}

/** Busca por prefijo de palabra primero y por contenido después.
 *
 *  Escribir "vez" tiene que dar Vezenkov antes que cualquier apellido que
 *  contenga esas letras por dentro. */
export function searchPlayers(
  searchIndex: SearchEntry[],
  query: string,
  limit = 7,
): SearchEntry[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];

  const starts: SearchEntry[] = [];
  const contains: SearchEntry[] = [];

  for (const entry of searchIndex) {
    const at = entry.haystack.indexOf(needle);
    if (at === -1) continue;
    const isWordStart = at === 0 || entry.haystack[at - 1] === " ";
    (isWordStart ? starts : contains).push(entry);
    if (starts.length >= limit) break;
  }

  return [...starts, ...contains].slice(0, limit);
}
