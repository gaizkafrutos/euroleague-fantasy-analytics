/** Acceso a los datos generados por el pipeline.
 *
 *  Se importan como JSON en build time: no hay fetch en runtime, ni base de
 *  datos, ni función serverless que pueda fallar. Cuando el GitHub Action
 *  commitea un snapshot nuevo, Vercel reconstruye y eso es el despliegue.
 */
import lineupJson from "@/data/lineup.json";
import matchingJson from "@/data/matching.json";
import metaJson from "@/data/meta.json";
import playersJson from "@/data/players.json";
import teamsJson from "@/data/teams.json";

import type { DetailsIndex, Lineup, MatchRow, Meta, Player, PlayerDetail, Team } from "./types";

export const players = playersJson as unknown as Player[];
export const teams = teamsJson as unknown as Team[];
export const meta = metaJson as unknown as Meta;
export const lineup = lineupJson as unknown as Lineup;
export const matching = matchingJson as unknown as MatchRow[];

/** Solo jugadores (sin entrenadores) con precio y posición utilizables. */
export const rosterPlayers: Player[] = players.filter(
  (player) => !player.isCoach && player.position !== null,
);

export const playersById = new Map<number, Player>(players.map((p) => [p.id, p]));
export const teamsByCode = new Map<string, Team>(teams.map((t) => [t.code, t]));

export function getPlayer(id: number): Player | undefined {
  return playersById.get(id);
}

export function getTeam(code: string | null): Team | undefined {
  return code ? teamsByCode.get(code) : undefined;
}

/** Detalle de un jugador. Se importa de forma perezosa: solo la ficha lo necesita. */
export async function getDetail(id: number): Promise<PlayerDetail> {
  const details = (await import("@/data/details.json")).default as unknown as DetailsIndex;
  return details[String(id)] ?? { priceHistory: [], recent: [], fixtures: [] };
}

/** Jugadores con precio conocido — lo que el explorador de mercado puede ordenar. */
export const pricedPlayers: Player[] = rosterPlayers.filter(
  (player) => typeof player.price === "number" && player.price > 0,
);
