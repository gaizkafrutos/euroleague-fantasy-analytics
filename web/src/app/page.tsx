import Link from "next/link";

import MarketExplorer from "@/components/market/MarketExplorer";
import { Notice, PlayerCell, StatTile, prettyName } from "@/components/ui/primitives";
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

  const averageValue =
    universe.reduce((sum, player) => sum + (player.valueProjected ?? 0), 0) /
    (universe.filter((player) => player.valueProjected != null).length || 1);

  return (
    <>
      <section className="section shell">
        <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
          <span className="eyebrow">
            {meta.seasonLabel} · Jornada {meta.currentRound} de {meta.totalRounds}
          </span>
          <h1 className="gradient-text">Quién rinde más de lo que cuesta</h1>
          <p className="lede">
            Los precios del EuroLeague Fantasy Challenge cruzados con las estadísticas
            oficiales de la competición. Cada puntuación fantasy está recalculada partido a
            partido con el baremo real del juego, no estimada: eso permite separar al
            jugador regular del que alterna un 30 con un 4.
          </p>
        </div>

        {meta.warnings.length ? (
          <div className="stack" style={{ marginTop: 20, "--gap": "10px" } as React.CSSProperties}>
            {meta.warnings.map((warning) => (
              <Notice key={warning}>{warning}</Notice>
            ))}
          </div>
        ) : null}

        <div className="grid grid-4" style={{ marginTop: 24 }}>
          <StatTile
            label="Jugadores"
            value={universe.length}
            sub={`${percent(meta.matchRate)} cruzados con el censo oficial`}
          />
          <StatTile
            label="Rendimiento"
            value={meta.performanceSource.games}
            sub={
              meta.performanceSource.isBaseline
                ? `partidos de referencia (${meta.performanceSource.source})`
                : "partidos de esta temporada"
            }
          />
          <StatTile
            label="Valor medio"
            value={num(averageValue, 2)}
            sub="puntos proyectados por crédito"
          />
          <StatTile
            label="Capturas de precio"
            value={meta.priceSnapshots}
            sub={meta.hasPrices ? "snapshots acumulados" : "pendiente del primer snapshot"}
          />
        </div>
      </section>

      <section className="section shell">
        <div className="grid grid-3">
          <RankCard
            title="Mejores chollos"
            note="Índice compuesto: valor por crédito, proyección, fiabilidad, rol y presión de precio."
            players={topBargains}
            render={(player) => `${num(player.bargainScore, 0)}`}
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

      {lineup.available && lineup.players ? (
        <section className="section shell">
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Once óptimo con {credits(lineup.budget)}</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  La mejor combinación posible respetando las reglas del juego: 4 bases, 4
                  aleros, 2 pívots, máximo 6 jugadores del mismo club. Resuelto por
                  programación entera, así que es el óptimo, no una aproximación.
                </p>
              </div>
              <div className="num" style={{ textAlign: "right" }}>
                <strong style={{ fontSize: "1.3rem" }}>{num(lineup.totalProjection)}</strong>
                <div className="muted" style={{ fontSize: "0.78rem" }}>
                  pts proyectados · {credits(lineup.totalPrice)}
                </div>
              </div>
            </div>
            <div className="table-wrap">
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
                            <span className="badge" style={{ marginLeft: 8 }}>
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
          </div>
        </section>
      ) : null}

      <section className="section shell">
        <div className="spread" style={{ marginBottom: 18 }}>
          <h2>Explorador de mercado</h2>
          <p className="card-note" style={{ margin: 0 }}>
            Ordena por cualquier columna. Pincha en un jugador para ver su historial completo.
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
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          <p className="card-note" style={{ margin: "4px 0 0" }}>
            {note}
          </p>
        </div>
      </div>
      {players.length ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {players.map((player) => (
            <li
              key={player.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "7px 0",
                borderTop: "1px solid var(--hairline)",
              }}
            >
              <PlayerCell player={player} />
              <strong className="num">{render(player)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Aún no hay partidos suficientes para este ranking.
        </p>
      )}
    </div>
  );
}
