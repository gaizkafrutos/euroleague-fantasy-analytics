import type { Metadata } from "next";
import Link from "next/link";

import SquadConsole, { type NextMatch } from "@/components/team/SquadConsole";
import { getTeam, lineup, meta, players, pricedPlayers, rosterPlayers, teams } from "@/lib/data";

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

  const nextByClub: Record<string, NextMatch> = {};
  for (const team of teams) {
    const fixture = team.fixtures[0];
    if (fixture) {
      nextByClub[team.code] = {
        opponent: getTeam(fixture.opponent)?.short ?? fixture.opponent,
        home: fixture.home,
      };
    }
  }

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
        market={market}
        coaches={coaches}
        optimal={optimal}
        nextByClub={nextByClub}
        rosterConfigured={Boolean(process.env.FANTAKING_TOKEN && process.env.EFA_FANTASY_TEAM_ID)}
      />
    </section>
  );
}
