/** Índice de búsqueda para el buscador de la cabecera. SOLO servidor.
 *
 *  Lo construye el layout y se lo pasa al buscador como prop, así que viaja en
 *  el HTML de cada página con lo mínimo (nombre, club, posición y la cadena
 *  normalizada), unos 30 KB, en vez de todo `players.json` en el JS.
 */
import { credits, displayName, normalize, positionLabel } from "./format";
import type { SearchEntry } from "./search";
import { pricedPlayers, rosterPlayers, teams } from "./data";

const source = pricedPlayers.length ? pricedPlayers : rosterPlayers;

// Equipos primero: escribir "real" llevaba a siete jugadores y no al club.
const teamEntries: SearchEntry[] = teams.map((team, index) => ({
  id: -1 - index,
  name: team.name ?? team.code,
  club: team.code,
  position: null,
  href: `/equipos/${team.code}`,
  meta: "Equipo",
  haystack: normalize(`${team.name ?? ""} ${team.short ?? ""} ${team.code}`),
}));

// Jugadores por proyección y no por orden alfabético: entre los que casan,
// arriba el que más importa fichar.
const playerEntries: SearchEntry[] = [...source]
  .sort((a, b) => (b.projectedFp ?? 0) - (a.projectedFp ?? 0))
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
      meta: [club, positionLabel(player.position), player.price ? credits(player.price) : null]
        .filter(Boolean)
        .join(" · "),
      haystack: normalize(`${name} ${player.marketName ?? ""} ${club}`),
    };
  });

export const searchIndex: SearchEntry[] = [...teamEntries, ...playerEntries];

export type { SearchEntry };
