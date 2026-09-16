import Link from "next/link";

import MarketExplorer from "@/components/market/MarketExplorer";
import { PlayerCell, prettyName } from "@/components/ui/primitives";
import detailsJson from "@/data/details.json";
import { lineup, meta, pricedPlayers, rosterPlayers, teams } from "@/lib/data";
import { credits, num, percent } from "@/lib/format";
import type { Player } from "@/lib/types";

export default function MarketPage() {
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

  return (
    <>
      {/* -------------------------------------------------------- portada */}
      <section className="shell hero">
        <span className="eyebrow">{meta.seasonLabel}</span>
        <h1>Gana la jornada antes de que se juegue.</h1>
        <p className="lede">
          Los precios del Fantasy cruzados con las estadísticas oficiales de la EuroLiga.
          Quién rinde más de lo que cuesta, quién va a subir y quién está perdiendo sitio.
        </p>

        {/* La portada ya no abre con cuatro cifras sobre el propio dataset: abre
            con las dos cosas que se puede hacer aquí. */}
        <div className="hero-actions">
          <Link className="button-primary" href={hasLineup ? "#once-optimo" : "#explorador"}>
            {hasLineup ? "Ver el once óptimo" : "Explorar el mercado"}
          </Link>
          <Link className="button-ghost" href="/mi-equipo">
            Analizar mi equipo
          </Link>
        </div>

        {/* Una línea de estado en vez de cuatro fichas: qué se está mirando
            importa, pero no es el titular de la página. */}
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
              <h2>El once óptimo con {credits(lineup.budget)}</h2>
              <p className="card-note" style={{ margin: "8px 0 0", maxWidth: "62ch" }}>
                La mejor combinación posible respetando las reglas del juego — 4 bases,
                4 aleros, 2 pívots, máximo 6 del mismo club. Resuelto por programación
                entera, así que es el óptimo, no una aproximación.
              </p>
            </div>
            <div className="section-figure">
              <div className="tile-value" style={{ marginTop: 0 }}>
                {num(lineup.totalProjection)}
              </div>
              <div className="muted num" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                pts proyectados · {credits(lineup.totalPrice)}
              </div>
            </div>
          </div>

          <div className="table-wrap only-wide">
            <table className="data">
              <thead>
                <tr>
                  <th>Jugador</th>
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
                        {lineup.captain === player.key ? (
                          <span className="badge badge-accent" style={{ marginLeft: 9 }}>
                            Capitán
                          </span>
                        ) : null}
                      </Link>
                    </td>
                    <td className="num">{player.position}</td>
                    <td className="num">{player.club}</td>
                    <td className="num credit">{credits(player.price)}</td>
                    <td className="num">{num(player.projection)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* En el móvil, lista compacta: una tabla de cinco columnas obliga a
              hacer scroll lateral para leer la única cifra que importa. */}
          <ul className="lineup-list only-narrow">
            {lineup.players.map((player) => (
              <li key={player.key}>
                <Link href={`/jugador/${player.key}`}>
                  <span className="lineup-pos">{player.position}</span>
                  <span className="lineup-name">
                    {prettyName(player.name)}
                    {lineup.captain === player.key ? (
                      <span className="badge badge-accent">Capitán</span>
                    ) : null}
                    <i className="muted">{player.club}</i>
                  </span>
                  <span className="lineup-figures">
                    <b className="num">{num(player.projection)}</b>
                    <i className="credit num">{credits(player.price)}</i>
                  </span>
                </Link>
              </li>
            ))}
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
            Ordena por cualquier columna. Pincha en un jugador para ver su historial.
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
