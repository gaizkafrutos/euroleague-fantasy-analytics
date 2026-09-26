import type { Metadata } from "next";
import Link from "next/link";

import SquadConsole from "@/components/team/SquadConsole";
import { lineup, meta, players, pricedPlayers, rosterPlayers } from "@/lib/data";
import type { Player } from "@/lib/types";

export const metadata: Metadata = {
  title: "Mi equipo",
  description:
    "Tu plantilla del EuroLeague Fantasy Challenge sobre la cancha: quinteto, sexto hombre, banquillo y entrenador, con lo que de verdad puntúa cada uno.",
};

export default function TeamPage() {
  const market = meta.hasPrices ? pricedPlayers : rosterPlayers;
  // Los entrenadores no están en `rosterPlayers` (no tienen puesto), pero son
  // una plaza obligatoria de la plantilla y se fichan igual.
  const coaches = players.filter((player) => player.isCoach && (player.price ?? 0) > 0);

  // El óptimo del pipeline, en ids. Es el que se carga con "Rellenar con el
  // óptimo" a 100 créditos, y contra el que se mide la plantilla.
  const optimal =
    lineup.available && lineup.players
      ? {
          playerIds: lineup.players.map((player) => Number(player.key)),
          coachId: lineup.coach ? Number(lineup.coach.key) : null,
          scored: lineup.scoredProjection ?? null,
        }
      : null;

  return (
    <section className="section shell">
      <header className="cancha-head">
        <p className="eq-eyebrow">
          <i aria-hidden /> Jornada {meta.currentRound}
        </p>
        <h1>Tu once, y lo que de verdad va a puntuar.</h1>
        <p className="lede">
          Monta la plantilla y la consola la coloca: los seis que más proyectan puntúan enteros, el
          mejor lleva el brazalete y los cuatro últimos van al banquillo a la mitad. Luego señala a
          quién le pagas de más y qué fichaje cabe.{" "}
          <Link href="/metodologia#reglas">Las reglas, en 30 segundos</Link>.
        </p>
      </header>
      <SquadConsole
        market={market.map(squadRow)}
        coaches={coaches.map(squadRow)}
        optimal={optimal}
        round={meta.currentRound}
        regularRounds={meta.totalRounds}
        rosterConfigured={Boolean(process.env.FANTAKING_TOKEN && process.env.EFA_FANTASY_TEAM_ID)}
      />
    </section>
  );
}

/** Lo que la consola necesita de cada jugador. El registro entero (medias de
 *  caja, estadísticas del mercado, emparejamiento…) viajaba serializado en el
 *  HTML de la página: unos 690 KB para usar una docena de campos. */
function squadRow(player: Player): Player {
  return {
    id: player.id,
    name: player.name,
    marketName: player.marketName,
    club: player.club,
    clubName: player.clubName,
    clubShort: player.clubShort,
    clubCrest: player.clubCrest,
    position: player.position,
    isCoach: player.isCoach,
    image: player.image,
    price: player.price,
    projectedFp: player.projectedFp,
    projectedIfPlays: player.projectedIfPlays,
    playProb: player.playProb,
    valueProjected: player.valueProjected,
    availability: player.availability,
    registered: player.registered,
    outlook: player.outlook ? { sd: player.outlook.sd } : null,
    schedule: { difficulty: null, next: player.schedule.next ?? null },
    perf: { gamesPlayed: player.perf.gamesPlayed },
  } as unknown as Player;
}
