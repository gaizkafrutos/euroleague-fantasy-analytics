/** Índice de búsqueda para el buscador de la cabecera. SOLO servidor.
 *
 *  Lo construye el layout y se lo pasa al buscador como prop, así que viaja en
 *  el HTML de cada página con lo mínimo (nombre, club, posición y la cadena
 *  normalizada), unos 30 KB, en vez de todo `players.json` en el JS.
 */
import { displayName, normalize } from "./format";
import type { SearchEntry } from "./search";
import { pricedPlayers, rosterPlayers } from "./data";

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

export type { SearchEntry };
