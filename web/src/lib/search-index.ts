/** Índice de búsqueda para el buscador de la cabecera.
 *
 *  Va en el bundle de todas las páginas, así que lleva lo mínimo: nombre ya
 *  formateado, club, posición y la cadena normalizada con la que se compara.
 *  Son unos 12 KB para 300 jugadores; las fotos se quedan fuera por eso.
 */
import { displayName, normalize } from "./format";
import { pricedPlayers, rosterPlayers } from "./data";

export interface SearchEntry {
  id: number;
  name: string;
  club: string;
  position: string | null;
  /** Nombre + club sin acentos, en minúscula. */
  haystack: string;
}

const source = pricedPlayers.length ? pricedPlayers : rosterPlayers;

export const searchIndex: SearchEntry[] = source
  .map((player) => {
    // `displayName` y no `prettyName(player.name)`: los que no cruzan con el
    // censo tienen `name` a null, salían como "—" arriba del todo y no se
    // encontraban por su apellido. Se indexa también el nombre del mercado
    // ("M. Jaiteh"), que es como aparecen en el juego.
    const name = displayName(player);
    const club = player.clubShort ?? player.club ?? "";
    return {
      id: player.id,
      name,
      club,
      position: player.position,
      haystack: normalize(`${name} ${player.marketName ?? ""} ${club}`),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "es"));

/** Busca por prefijo de palabra primero y por contenido después.
 *
 *  Escribir "vez" tiene que dar Vezenkov antes que cualquier apellido que
 *  contenga esas letras por dentro. */
export function searchPlayers(query: string, limit = 7): SearchEntry[] {
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
