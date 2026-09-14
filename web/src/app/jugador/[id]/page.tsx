import { notFound } from "next/navigation";

import GameLogBars from "@/components/charts/GameLogBars";
import PriceHistory from "@/components/charts/PriceHistory";
import { PositionBadge, StatTile, prettyName } from "@/components/ui/primitives";
import { getDetail, getPlayer, getTeam, players } from "@/lib/data";
import { credits, dateShort, num, percent, signed } from "@/lib/format";

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

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(Number(id));
  if (!player) notFound();

  const detail = await getDetail(player.id);
  const team = getTeam(player.club);

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

  return (
    <>
      <section className="section shell">
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          {player.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.image}
              alt=""
              width={92}
              height={92}
              style={{
                borderRadius: "50%",
                objectFit: "cover",
                border: "1px solid var(--ring)",
                background: "var(--surface-2)",
              }}
            />
          ) : null}
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span className="eyebrow">
              {team?.crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="crest" src={team.crest} alt="" />
              ) : null}
              {player.clubName ?? "—"}
              {player.dorsal ? ` · #${player.dorsal}` : ""}
            </span>
            <h1 className="gradient-text">{prettyName(player.name)}</h1>
            <div className="row">
              <PositionBadge position={player.position} />
              {player.height ? <span className="badge">{player.height} cm</span> : null}
              {player.country ? <span className="badge">{player.country}</span> : null}
              {player.birthDate ? (
                <span className="badge">{age(player.birthDate)} años</span>
              ) : null}
              <span className="badge" title={`Cruce por ${player.match.method}`}>
                ID oficial {player.personCode ?? "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 26 }}>
          <StatTile
            label="Precio"
            value={<span className="credit">{credits(player.price)}</span>}
            sub={
              player.priceDeltaTotal
                ? `${signed(player.priceDeltaTotal)} cr desde el inicio`
                : "sin variación registrada"
            }
          />
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
            <dl style={{ margin: 0, display: "grid", gap: 10 }}>
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
              <Row
                label="Puntos por minuto"
                value={num(player.perf.fpPerMin, 2)}
              />
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
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {detail.fixtures.map((fixture) => (
                  <li
                    key={`${fixture.round}-${fixture.opponent}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 0",
                      borderTop: "1px solid var(--hairline)",
                    }}
                  >
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
        </div>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <dt className="muted">{label}</dt>
      <dd className="num" style={{ margin: 0, fontWeight: 600 }}>
        {value}
      </dd>
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
