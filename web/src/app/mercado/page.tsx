/** El mercado.
 *
 *  Era la portada. Cuando la portada pasó a ser una carta de presentación, todo
 *  esto se mudó aquí tal cual: las tres señales, el once óptimo y el explorador.
 *  Es una página normal, sin relato ni scroll dirigido — la que se abre para
 *  trabajar, no para que te cuenten qué es esto.
 */
import type { Metadata } from "next";
import Link from "next/link";

import MarketExplorer from "@/components/market/MarketExplorer";
import { PlayerCell, prettyName } from "@/components/ui/primitives";
import detailsJson from "@/data/details.json";
import { getPlayer, getTeam, lineup, meta, pricedPlayers, rosterPlayers, teams } from "@/lib/data";
import { credits, displayName, num, percent } from "@/lib/format";
import type { Player } from "@/lib/types";

export const metadata: Metadata = {
  title: "Mercado",
  description:
    "Los precios del EuroLeague Fantasy Challenge cruzados con las estadísticas oficiales: " +
    "chollos, rol al alza, los más fiables y el explorador completo.",
};

export default function MercadoPage() {
  const universe = meta.hasPrices ? pricedPlayers : rosterPlayers;
  const details = detailsJson as unknown as Record<string, { recent: Array<{ fp: number }> }>;

  const topBargains = [...universe]
    .filter((player) => (player.perf.gamesPlayed ?? 0) >= 5)
    .sort((a, b) => (b.bargainScore ?? 0) - (a.bargainScore ?? 0))
    .slice(0, 5);

  const risingRole = [...universe]
    .filter((player) => (player.perf.gamesPlayed ?? 0) >= 5)
    .sort((a, b) => (b.perf.minutesShareTrend ?? 0) - (a.perf.minutesShareTrend ?? 0))
    .slice(0, 5);

  const mostConsistent = [...universe]
    .filter((player) => (player.perf.gamesPlayed ?? 0) >= 10 && (player.perf.fpAvg ?? 0) >= 10)
    .sort((a, b) => (b.perf.consistency ?? 0) - (a.perf.consistency ?? 0))
    .slice(0, 5);

  const isBaseline = meta.performanceSource.isBaseline;
  const hasLineup = Boolean(lineup.available && lineup.players);

  // Quién puntúa al 100 % y quién a la mitad. Sin esto la tabla enseña diez
  // nombres y deja creer que suman todos igual, que es justo lo que no pasa.
  const starters = new Set(lineup.starters ?? []);
  const bench = new Set(lineup.bench ?? []);

  return (
    <>
      <section className="shell hero">
        <span className="eyebrow">{meta.seasonLabel}</span>
        <h1>Mercado</h1>
        <p className="lede">
          Quién rinde más de lo que cuesta, quién va a subir y quién está perdiendo sitio.
        </p>

        <div className="status-strip">
          <span className={`status-dot${isBaseline ? "" : " is-live"}`} aria-hidden />
          <span>
            {isBaseline
              ? `Referencia: ${meta.performanceSource.games} partidos de la 2025-26`
              : `${meta.performanceSource.games} partidos de esta temporada`}
          </span>
          <span className="status-sep">·</span>
          <span className="num">
            {universe.length} jugadores, {percent(meta.matchRate)} identificados
          </span>
          <span className="status-sep">·</span>
          <span className="num">
            {meta.priceSnapshots} {meta.priceSnapshots === 1 ? "captura" : "capturas"} de precio
          </span>
          <span className="status-sep">·</span>
          <Link href="/metodologia">Metodología</Link>
        </div>
      </section>

      {/* -------------------------------------------------------- señales */}
      <section className="section shell">
        <div className="section-head">
          <div>
            <h2>Las tres señales de la semana</h2>
          </div>
          <p className="card-note" style={{ margin: 0 }}>
            Requieren al menos cinco partidos jugados para entrar en el ranking.
          </p>
        </div>

        <div className="grid grid-3">
          <RankCard
            title="Mejores chollos"
            note="Índice compuesto: valor por crédito, proyección, fiabilidad, rol y presión de precio."
            players={topBargains}
            render={(player) => num(player.bargainScore, 0)}
          />
          <RankCard
            title="Rol al alza"
            note="Mayor ganancia de peso en los minutos de su equipo en las últimas jornadas."
            players={risingRole}
            render={(player) => `+${num((player.perf.minutesShareTrend ?? 0) * 100, 1)} pp`}
          />
          <RankCard
            title="Los más fiables"
            note="Menor dispersión en su puntuación. Lo que se busca en un titular indiscutible."
            players={mostConsistent}
            render={(player) => percent(player.perf.consistency)}
          />
        </div>
      </section>

      {/* -------------------------------------------------- once óptimo */}
      {hasLineup && lineup.players ? (
        <section className="section shell" id="once-optimo">
          <div className="section-head">
            <div>
              <h2>El equipo óptimo con {credits(lineup.budget)}</h2>
              <p className="card-note" style={{ margin: "8px 0 0", maxWidth: "62ch" }}>
                La mejor combinación posible respetando las reglas del juego — 4 bases, 4 aleros, 2
                pívots, un entrenador, máximo 6 del mismo club. Resuelto por programación entera,
                así que es el óptimo, no una aproximación.
              </p>
            </div>
            <div className="section-figure">
              <div className="tile-value" style={{ marginTop: 0 }}>
                {num(lineup.scoredProjection ?? lineup.totalProjection)}
              </div>
              <div className="muted num" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                pts con el baremo real · {credits(lineup.totalPrice)}
              </div>
            </div>
          </div>

          {/* La suma llana engaña en las dos direcciones: el capitán suma el
              doble y el banquillo la mitad. Se dicen las dos cifras. */}
          {typeof lineup.scoredProjection === "number" ? (
            <p className="card-note" style={{ margin: "0 0 18px", maxWidth: "66ch" }}>
              Suma llana de los once: {num(lineup.totalProjection)} puntos. Con el capitán al doble,
              el quinteto y el sexto hombre al 100 % y el banquillo a la mitad, lo que de verdad
              puntúa son {num(lineup.scoredProjection)}. El presupuesto se concentra en los seis que
              puntúan enteros.
            </p>
          ) : null}

          <div className="table-wrap only-wide">
            <table className="data">
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>Rol</th>
                  <th className="num">Pos</th>
                  <th className="num">Club</th>
                  <th className="num">Precio</th>
                  <th className="num">Proyección</th>
                </tr>
              </thead>
              <tbody>
                {lineup.players.map((player) => (
                  <tr key={player.key}>
                    <td>
                      <Link href={`/jugador/${player.key}`} className="player-name">
                        {prettyName(player.name)}
                      </Link>
                    </td>
                    <td>
                      <RoleBadge
                        role={roleOf(player.key, starters, bench, lineup.sixth)}
                        captain={lineup.captain === player.key}
                      />
                    </td>
                    <td className="num">{player.position}</td>
                    <td className="num">{player.club}</td>
                    <td className="num credit">{credits(player.price)}</td>
                    <td className="num">{num(player.projection)}</td>
                  </tr>
                ))}
                {lineup.coach ? (
                  <tr>
                    <td>{coachLabel(lineup.coach)}</td>
                    <td>
                      <span className="badge">Entrenador</span>
                    </td>
                    <td className="num">E</td>
                    <td className="num">{lineup.coach.club}</td>
                    <td className="num credit">{credits(lineup.coach.price)}</td>
                    <td className="num">{num(lineup.coach.projection)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* En el móvil, lista compacta: una tabla de seis columnas obliga a
              hacer scroll lateral para leer la única cifra que importa. */}
          <ul className="lineup-list only-narrow">
            {lineup.players.map((player) => (
              <li key={player.key}>
                <Link href={`/jugador/${player.key}`}>
                  <span className="lineup-pos">{player.position}</span>
                  <span className="lineup-name">
                    {prettyName(player.name)}
                    <RoleBadge
                      role={roleOf(player.key, starters, bench, lineup.sixth)}
                      captain={lineup.captain === player.key}
                    />
                    <i className="muted">{player.club}</i>
                  </span>
                  <span className="lineup-figures">
                    <b className="num">{num(player.projection)}</b>
                    <i className="credit num">{credits(player.price)}</i>
                  </span>
                </Link>
              </li>
            ))}
            {lineup.coach ? (
              <li>
                <span className="lineup-static">
                  <span className="lineup-pos">E</span>
                  <span className="lineup-name">
                    {coachLabel(lineup.coach)}
                    <span className="badge">Entrenador</span>
                    <i className="muted">{lineup.coach.club}</i>
                  </span>
                  <span className="lineup-figures">
                    <b className="num">{num(lineup.coach.projection)}</b>
                    <i className="credit num">{credits(lineup.coach.price)}</i>
                  </span>
                </span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* ---------------------------------------------------- explorador */}
      <section className="section shell" id="explorador">
        <div className="section-head">
          <div>
            <h2>Explorador de mercado</h2>
          </div>
          <p className="card-note" style={{ margin: 0 }}>
            Ordena por cualquier columna. Pincha en un jugador para ver su ficha.
          </p>
        </div>
        <MarketExplorer
          players={universe}
          teams={teams}
          details={details}
          hasPrices={meta.hasPrices}
        />
      </section>
    </>
  );
}

type Role = "titular" | "sexto" | "banquillo" | null;

function roleOf(
  key: string,
  starters: Set<string>,
  bench: Set<string>,
  sixth: string | null | undefined,
): Role {
  if (starters.has(key)) return "titular";
  if (key === sixth) return "sexto";
  if (bench.has(key)) return "banquillo";
  return null;
}

function RoleBadge({ role, captain }: { role: Role; captain: boolean }) {
  if (captain) return <span className="badge badge-accent">Capitán ×2</span>;
  if (role === "titular") return <span className="badge">Quinteto</span>;
  if (role === "sexto") return <span className="badge">Sexto hombre</span>;
  if (role === "banquillo") return <span className="badge badge-half">Banquillo ×0,5</span>;
  return null;
}

/** Los entrenadores no cruzan con el censo oficial, así que el lineup los
 *  trae sin nombre. La ficha del mercado sí tiene el suyo ("X. Albert"); si
 *  ni eso, el club identifica igual de bien y no inventa nada. */
function coachLabel(coach: { key: string; name: string | null; club: string }): string {
  if (coach.name) return prettyName(coach.name);
  const player = getPlayer(Number(coach.key));
  if (player?.marketName) return displayName(player);
  const team = getTeam(coach.club);
  return team?.name ? `Entrenador del ${team.name}` : "Entrenador";
}

function RankCard({
  title,
  note,
  players,
  render,
}: {
  title: string;
  note: string;
  players: Player[];
  render: (player: Player) => string;
}) {
  return (
    <div className="card">
      <div className="card-head" style={{ display: "block", marginBottom: 16 }}>
        <div className="card-title">{title}</div>
        <p className="card-note" style={{ margin: "6px 0 0" }}>
          {note}
        </p>
      </div>
      {players.length ? (
        <ol className="rank-list">
          {players.map((player, index) => (
            <li key={player.id} className={index === 0 ? "is-lead" : undefined}>
              <PlayerCell player={player} />
              <span className="rank-value">{render(player)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          Aún no hay partidos suficientes para este ranking.
        </p>
      )}
    </div>
  );
}
