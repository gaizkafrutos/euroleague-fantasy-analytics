import Link from "next/link";

import { meta, rosterPlayers, teams } from "@/lib/data";
import { num, percent } from "@/lib/format";

export const metadata = {
  title: "Equipos",
  description:
    "Rating ofensivo y defensivo de los 20 clubes de la EuroLeague y dificultad de sus próximos partidos.",
};

export default function TeamsPage() {
  const ranked = [...teams].sort((a, b) => (b.netRating ?? 0) - (a.netRating ?? 0));
  const countByTeam = new Map<string, number>();
  for (const player of rosterPlayers) {
    if (player.club) countByTeam.set(player.club, (countByTeam.get(player.club) ?? 0) + 1);
  }

  return (
    <section className="section shell">
      <div className="stack" style={{ "--gap": "12px", marginBottom: 24 } as React.CSSProperties}>
        <span className="eyebrow">{meta.seasonLabel}</span>
        <h1 className="gradient-text">Equipos y calendario</h1>
        <p className="lede">
          El rating de cada club y lo duro que tiene el calendario a tres jornadas vista.
          Importa más de lo que parece: el bonus de victoria suma un 10% a la puntuación de
          todos sus jugadores, y el entrenador puntúa solo por el marcador.
          {meta.teamStrengthSource ? ` Ratings calculados con datos de la ${meta.teamStrengthSource}.` : ""}
        </p>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Club</th>
              <th className="num">Anotados</th>
              <th className="num">Recibidos</th>
              <th className="num">Diferencial</th>
              <th className="num">% victorias</th>
              <th className="num">Calendario</th>
              <th className="num">Jugadores</th>
              <th>Próximos</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((team) => (
              <tr key={team.code}>
                <td>
                  <span className="player-cell">
                    {team.crest ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="crest" src={team.crest} alt="" loading="lazy" />
                    ) : null}
                    <span>
                      <span className="player-name">{team.short ?? team.name}</span>
                      <br />
                      <span className="player-meta">{team.country}</span>
                    </span>
                  </span>
                </td>
                <td className="num">{num(team.offense)}</td>
                <td className="num">{num(team.defense)}</td>
                <td className="num">
                  <strong>{num(team.netRating)}</strong>
                </td>
                <td className="num">{percent(team.winRate)}</td>
                <td className="num">{num(team.difficulty, 0)}</td>
                <td className="num">{countByTeam.get(team.code) ?? 0}</td>
                <td>
                  {team.fixtures.length
                    ? team.fixtures
                        .map((fixture) => `${fixture.home ? "vs" : "@"} ${fixture.opponent}`)
                        .join(" · ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="card-note" style={{ marginTop: 14 }}>
        Calendario: 100 es el trío de rivales más duro de la liga, 0 el más asequible. Jugar
        fuera penaliza. <Link href="/metodologia">Cómo se calcula</Link>.
      </p>
    </section>
  );
}
