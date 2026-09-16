import Link from "next/link";
import { notFound } from "next/navigation";

import GameLogBars from "@/components/charts/GameLogBars";
import PriceHistory from "@/components/charts/PriceHistory";
import { PercentileBar, PositionBadge, StatTile, prettyName } from "@/components/ui/primitives";
import { getDetail, getPlayer, getTeam, players } from "@/lib/data";
import { POSITION_PLURAL, credits, dateShort, num, percent, signed } from "@/lib/format";
import { percentileRows, poolSize, type PercentileKey } from "@/lib/percentiles";
import { verdictFor } from "@/lib/verdict";
import type { Player } from "@/lib/types";

export function generateStaticParams() {
  return players.map((player) => ({ id: String(player.id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(Number(id));
  if (!player) return { title: "Jugador no encontrado" };
  return {
    title: prettyName(player.name),
    description: `${prettyName(player.name)} — ${player.clubName ?? ""}. Precio, proyección, consistencia y evolución en el EuroLeague Fantasy Challenge.`,
  };
}

const PERCENTILE_KEYS: PercentileKey[] = [
  "projectedFp",
  "valueProjected",
  "fpAvg",
  "consistency",
  "minutesAvg",
];

/** El número real detrás de cada percentil: el percentil sitúa, el número ancla. */
function percentileDetail(player: Player, key: PercentileKey): string {
  switch (key) {
    case "projectedFp":
      return `${num(player.projectedFp)} pts`;
    case "valueProjected":
      return `${num(player.valueProjected ?? player.valuePerCredit, 2)} pts/cr`;
    case "fpAvg":
      return `${num(player.perf.fpAvg)} pts`;
    case "consistency":
      return percent(player.perf.consistency);
    case "minutesAvg":
      return `${num(player.perf.minutesAvg)} min`;
    default:
      return "";
  }
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(Number(id));
  if (!player) notFound();

  const detail = await getDetail(player.id);
  const team = getTeam(player.club);
  const verdict = verdictFor(player);
  const percentiles = percentileRows(player, PERCENTILE_KEYS);
  const groupSize = poolSize(player.position);

  const marketRows: Array<[string, number | null | undefined]> = [
    ["Puntos", player.market.points],
    ["Rebotes", player.market.rebounds],
    ["Asistencias", player.market.assists],
    ["Robos", player.market.steals],
    ["Pérdidas", player.market.turnovers],
    ["Tapones", player.market.blocksFavour],
    ["Tapones recibidos", player.market.blocksAgainst],
    ["Faltas recibidas", player.market.foulsDrawn],
    ["Faltas cometidas", player.market.foulsCommitted],
    ["Tiros fallados", player.market.missedFg],
    ["Tiros libres fallados", player.market.missedFt],
  ];

  // Antes de la jornada 1 el mercado devuelve 0.0 en todas las columnas salvo el
  // precio. Mostrar la rejilla entera a cero parece un fallo del cálculo.
  const hasMarketStats = marketRows.some(([, value]) => typeof value === "number" && value !== 0);

  return (
    <>
      <section className="shell player-hero">
        <Link href="/" className="crumb">
          <span aria-hidden>←</span> Mercado
        </Link>

        <div className="player-head">
          {player.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="player-photo" src={player.image} alt="" width={108} height={108} />
          ) : null}

          <div className="player-identity">
            <span className="eyebrow">
              {team?.crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="crest" src={team.crest} alt="" />
              ) : null}
              {player.clubName ?? "—"}
              {player.dorsal ? ` · #${player.dorsal}` : ""}
            </span>
            <h1>{prettyName(player.name)}</h1>
            <div className="row player-facts">
              <PositionBadge position={player.position} />
              {player.height ? <span className="badge">{player.height} cm</span> : null}
              {player.birthDate ? <span className="badge">{age(player.birthDate)} años</span> : null}
              {player.country ? <span className="badge">{player.country}</span> : null}
            </div>
          </div>

          <div className="player-price">
            <div className="tile-label">Precio</div>
            <div className="player-price-value credit num">{credits(player.price)}</div>
            <div className="tile-sub num">
              {player.priceDeltaTotal
                ? `${signed(player.priceDeltaTotal)} cr desde el inicio`
                : "sin variación registrada"}
            </div>
          </div>
        </div>

        {/* El juicio, antes que los datos que lo sostienen. La ficha tenía
            dieciséis números y ninguna conclusión. */}
        <div className={`verdict is-${verdict.tone}`}>
          <p className="verdict-headline">{verdict.headline}</p>
          {verdict.reasons.length ? (
            <ul className="verdict-reasons">
              {verdict.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------- percentiles */}
      {percentiles.length ? (
        <section className="section shell">
          <div className="section-head">
            <div>
              <h2>Dónde cae entre los suyos</h2>
              <p className="card-note" style={{ margin: "8px 0 0", maxWidth: "62ch" }}>
                Comparado con los {groupSize}{" "}
                {(POSITION_PLURAL[player.position ?? ""] ?? "jugadores").toLowerCase()} del
                mercado que han jugado.
                Una media de 15 puntos no significa lo mismo en un pívot que en un base.
              </p>
            </div>
          </div>
          <div className="pctl-grid">
            {percentiles.map((row) => (
              <PercentileBar
                key={row.key}
                label={row.label}
                percentile={row.percentile}
                detail={percentileDetail(player, row.key)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------ cifras */}
      <section className="section shell">
        <div className="grid grid-4">
          <StatTile
            label="Proyección"
            value={num(player.projectedFp)}
            sub={`${num(player.valueProjected ?? player.valuePerCredit, 2)} pts por crédito`}
          />
          <StatTile
            label="Media / Forma"
            value={`${num(player.perf.fpAvg)} / ${num(player.perf.form)}`}
            sub={`suelo ${num(player.perf.fpFloor)} · techo ${num(player.perf.fpCeiling)}`}
          />
          <StatTile
            label="Fiabilidad"
            value={percent(player.perf.consistency)}
            sub={`desviación ${num(player.perf.fpStd)} pts`}
          />
          <StatTile
            label="Calendario"
            value={num(player.schedule.difficulty, 0)}
            sub="dificultad de los 3 próximos rivales, sobre 100"
          />
        </div>
      </section>

      <section className="section shell">
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Partido a partido</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Puntuación fantasy calculada con el baremo oficial del juego sobre los
                  boxscores reales.
                </p>
              </div>
            </div>
            <GameLogBars
              games={detail.recent}
              average={player.perf.fpAvg}
              floor={player.perf.fpFloor}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Evolución del precio</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Un punto por captura del mercado.
                </p>
              </div>
            </div>
            <PriceHistory points={detail.priceHistory} />
          </div>
        </div>
      </section>

      <section className="section shell">
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Rol en el equipo</div>
            </div>
            <dl className="fact-list">
              <Row label="Minutos por partido" value={num(player.perf.minutesAvg)} />
              <Row
                label="Minutos últimos 5"
                value={`${num(player.perf.minutesRecent)} (${signed(player.perf.minutesTrend)})`}
              />
              <Row
                label="Cuota de minutos del equipo"
                value={percent(player.perf.minutesShareRecent, 1)}
              />
              <Row label="Titularidades" value={percent(player.perf.startedRate)} />
              <Row label="Partidos sin jugar" value={percent(player.perf.dnpRate)} />
              <Row label="Puntos por minuto" value={num(player.perf.fpPerMin, 2)} />
            </dl>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Próximos partidos</div>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Dificultad del calendario: {num(player.schedule.difficulty, 0)} sobre 100.
                </p>
              </div>
            </div>
            {detail.fixtures.length ? (
              <ul className="fixture-list">
                {detail.fixtures.map((fixture) => (
                  <li key={`${fixture.round}-${fixture.opponent}`}>
                    <span>
                      <strong>J{fixture.round}</strong>{" "}
                      <span className="muted">{fixture.home ? "vs" : "@"}</span>{" "}
                      {getTeam(fixture.opponent)?.short ?? fixture.opponent}
                    </span>
                    <span className="muted num">{dateShort(fixture.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Sin calendario disponible.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="section shell">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Medias según el propio Fantasy</div>
              <p className="card-note" style={{ margin: "4px 0 0" }}>
                Lo que devuelve el mercado del juego. Sirve de contraste con lo calculado
                aquí desde los boxscores.
              </p>
            </div>
          </div>
          {hasMarketStats ? (
            <div className="grid grid-4">
              {marketRows.map(([label, value]) => (
                <div key={label}>
                  <div className="tile-label">{label}</div>
                  <div className="num" style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                    {num(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              El mercado todavía no publica medias: devuelve ceros en todas las columnas
              hasta que se juega la primera jornada. Una rejilla de ceros no dice nada, así
              que se muestra esto en su lugar.
            </p>
          )}
        </div>

        {/* La trazabilidad del cruce es una nota al pie, no una etiqueta de
            depuración junto al nombre del jugador. */}
        <p className="provenance">
          Identificado con el censo oficial de la EuroLiga
          {player.match.method ? ` por ${player.match.method}` : ""}
          {player.personCode ? ` · ficha ${player.personCode}` : ""}.{" "}
          <Link href="/metodologia">Cómo se cruzan los nombres</Link>
        </p>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function age(birthDate: string): number {
  const born = new Date(birthDate);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) years -= 1;
  return years;
}
