import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import CourtRole from "@/components/advanced/CourtRole";
import FantasyMix from "@/components/advanced/FantasyMix";
import PercentileStrip from "@/components/advanced/PercentileStrip";
import PriceOutlook from "@/components/advanced/PriceOutlook";
import ShotChart from "@/components/advanced/ShotChart";
import GameLogBars from "@/components/charts/GameLogBars";
import PriceHistory from "@/components/charts/PriceHistory";
import { PositionBadge, prettyName } from "@/components/ui/primitives";
import { seasonLabel, sequentialClass } from "@/lib/advanced";
import { getDetail, getPlayer, getTeam, meta, players } from "@/lib/data";
import {
  POSITION_PLURAL,
  credits,
  dateShort,
  displayName,
  num,
  percent,
  signed,
} from "@/lib/format";
import { percentileOf, poolSize, type PercentileKey } from "@/lib/percentiles";
import { verdictFor } from "@/lib/verdict";
import type { Player } from "@/lib/types";

export function generateStaticParams() {
  return players.map((player) => ({ id: String(player.id) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(Number(id));
  if (!player) return { title: "Jugador no encontrado" };
  const name = displayName(player);
  return {
    title: name,
    description: `${name} — ${player.clubName ?? ""}. Precio, proyección, consistencia y evolución en el EuroLeague Fantasy Challenge.`,
  };
}

/** Un globo: el número que importa, y dónde cae ese número entre los suyos.
 *
 *  Los seis son medias de caja, no puntuación fantasy: son las que explican
 *  POR QUÉ puntúa, que es lo que la ficha anterior no contaba en ningún sitio.
 */
interface OrbSpec {
  key: PercentileKey;
  label: string;
  value: number | null | undefined;
  unit?: string;
  /** El ± es polaridad, no magnitud: no lleva arco de percentil. */
  polarity?: boolean;
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = getPlayer(Number(id));
  if (!player) notFound();

  const detail = await getDetail(player.id);
  const team = getTeam(player.club);
  const verdict = verdictFor(player);
  const groupSize = poolSize(player.position);
  const perf = player.perf;
  const { given, surname } = splitName(player);
  // Sin partidos en la referencia, la proyección es un cero por falta de
  // datos, no una predicción. Se enseña como ausencia.
  const hasGames = (perf.gamesPlayed ?? 0) > 0;
  // La proyección ya no depende de haber jugado esta temporada: se apoya en la
  // anterior (o en el precio) hasta que haya partidos.
  const hasProjection = typeof player.projectedFp === "number" && player.projectedFp > 0;

  // El color del club entra solo aquí, y entra dos veces: el halo con el tono
  // del escudo, y los aros con ese mismo tono llevado a una luminosidad fija
  // para que los veinte pasen contraste sin elegir ninguno a ojo. Si un club
  // no tiene fila en club_colors.csv, todo cae al acento del sitio.
  const stageStyle = {
    "--club": team?.colors?.halo ?? "var(--surface-3)",
    "--stat-dark": team?.colors?.statDark ?? "var(--accent)",
    "--stat-light": team?.colors?.statLight ?? "var(--accent)",
  } as CSSProperties;

  const left: OrbSpec[] = [
    { key: "ptsAvg", label: "Puntos", value: perf.ptsAvg },
    { key: "rebAvg", label: "Rebotes", value: perf.rebAvg },
    { key: "astAvg", label: "Asistencias", value: perf.astAvg },
  ];
  const right: OrbSpec[] = [
    { key: "minutesAvg", label: "Minutos", value: perf.minutesAvg, unit: "min" },
    { key: "pirAvg", label: "Valoración", value: perf.pirAvg },
    { key: "plusMinusAvg", label: "Más / menos", value: perf.plusMinusAvg, polarity: true },
  ];
  const hasOrbs = [...left, ...right].some((spec) => usable(spec.value));

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
      {/* ============================================================= stage */}
      <section className="ficha-stage" style={stageStyle}>
        <div className="ficha-halo" aria-hidden />
        <div className="ficha-arc" aria-hidden />
        {player.dorsal ? (
          <div className="ficha-dorsal" aria-hidden>
            {player.dorsal}
          </div>
        ) : null}

        <div className="shell ficha-inner">
          <Link href="/mercado" className="crumb">
            <span aria-hidden>←</span> Mercado
          </Link>

          <p className="ficha-eyebrow">
            <span className="ficha-dot" aria-hidden />
            {player.clubName ?? "Sin equipo"}
            {player.dorsal ? ` · dorsal ${player.dorsal}` : ""}
          </p>

          <h1 className="ficha-name">
            {given ? <span className="given">{given}</span> : null}
            {surname}
          </h1>

          <div className="ficha-meta">
            {team?.crest ? (
              <Image className="ficha-crest" src={team.crest} alt="" width={22} height={22} />
            ) : null}
            <PositionBadge position={player.position} />
            {player.height ? <span className="badge">{player.height} cm</span> : null}
            {player.birthDate ? <span className="badge">{age(player.birthDate)} años</span> : null}
            {player.country ? <span className="badge">{player.country}</span> : null}
            <span className="ficha-price num">
              {credits(player.price)}
              <small>
                {player.priceDeltaTotal
                  ? `${signed(player.priceDeltaTotal)} cr`
                  : "sin variación"}
              </small>
            </span>
          </div>

          <div className={`ficha-orbit${hasOrbs ? "" : " is-bare"}`}>
            <div className="ficha-metrics is-left">
              {left.map((spec) => (
                <Orb key={spec.key} player={player} spec={spec} />
              ))}
            </div>

            <figure className="ficha-portrait">
              {player.image ? (
                <Image
                  src={player.image}
                  alt=""
                  width={750}
                  height={1000}
                  sizes="(min-width: 620px) 340px, 62vw"
                  priority
                />
              ) : (
                <div className="ficha-portrait-empty" aria-hidden>
                  {surname.slice(0, 1)}
                </div>
              )}
            </figure>

            <div className="ficha-metrics is-right">
              {right.map((spec) => (
                <Orb key={spec.key} player={player} spec={spec} />
              ))}
            </div>
          </div>

          {/* Lo que solo está aquí: la capa de fantasy tiene color propio,
              ni el del sitio ni el del club. */}
          <div className="ficha-band">
            <p className="ficha-band-label">Para la jornada</p>
            <dl className="ficha-band-grid">
              <BandItem
                label="Proyección"
                value={hasProjection ? num(player.projectedFp) : "—"}
                unit={hasProjection ? "pts" : undefined}
                note={pctNote(player, "projectedFp")}
              />
              <BandItem
                label="Por crédito"
                value={hasProjection ? num(player.valueProjected ?? player.valuePerCredit, 2) : "—"}
                unit={hasProjection ? "pts/cr" : undefined}
                note={pctNote(player, "valueProjected")}
              />
              <BandItem
                label="Fiabilidad"
                value={(perf.gamesPlayed ?? 0) >= 3 ? percent(perf.consistency) : "—"}
                note={(perf.gamesPlayed ?? 0) >= 3 ? pctNote(player, "consistency") : "3+ partidos"}
              />
              <BandItem
                label="Forma"
                value={num(perf.form)}
                unit={hasGames ? "pts" : undefined}
                note={
                  typeof perf.formDelta === "number"
                    ? `${signed(perf.formDelta)} vs su media`
                    : null
                }
              />
            </dl>
          </div>

          {groupSize && hasGames ? (
            <p className="ficha-note">
              Los percentiles comparan con los {groupSize}{" "}
              {(POSITION_PLURAL[player.position ?? ""] ?? "jugadores").toLowerCase()} del mercado
              que han jugado. Una media de 15 puntos no significa lo mismo en un pívot que en un
              base.
            </p>
          ) : null}
        </div>
      </section>

      {/* ========================================================= veredicto */}
      <section className="section shell">
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

      {player.outlook && player.price && typeof player.projectedFp === "number" ? (
        <section className="section shell">
          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">¿Sube o baja de precio?</h2>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  El juego revaloriza según lo que puntúa frente a lo que cuesta. Ajustado sobre{" "}
                  {meta.priceModel?.n ?? "—"} jugadores del último mercado: explica el{" "}
                  {percent(meta.priceModel?.r2 ?? null)} de las variaciones.
                </p>
              </div>
            </div>
            <PriceOutlook
              outlook={player.outlook}
              projection={player.projectedFp}
              price={player.price}
              out={player.availability?.level === "out"}
            />
          </div>
        </section>
      ) : null}

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
              average={perf.fpAvg}
              floor={perf.fpFloor}
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

      {detail.mix || detail.court ? (
        <section className="section shell">
          <div className="grid grid-2">
            {detail.mix ? (
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2 className="card-title">De dónde salen sus puntos</h2>
                    <p className="card-note" style={{ margin: "4px 0 0" }}>
                      Media por partido de cada acción del baremo · {seasonLabel(detail.mix.season)},{" "}
                      {detail.mix.games} {detail.mix.games === 1 ? "partido" : "partidos"}.
                    </p>
                  </div>
                </div>
                <FantasyMix mix={detail.mix} />
              </div>
            ) : null}
            {detail.court ? (
              <div className="card">
                <div className="card-head">
                  <div>
                    <h2 className="card-title">En pista</h2>
                    <p className="card-note" style={{ margin: "4px 0 0" }}>
                      Reconstruido cambio a cambio desde el jugada a jugada oficial.
                    </p>
                  </div>
                </div>
                <CourtRole court={detail.court} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {detail.shots && meta.league ? (
        <section className="section shell">
          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Mapa de tiro</h2>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Cada tiro fallado le resta un punto fantasy: dónde tira importa tanto como
                  cuánto.
                </p>
              </div>
            </div>
            <ShotChart
              uid={String(player.id)}
              shots={detail.shots}
              league={meta.league.zones}
              keys={meta.league.zoneKeys}
              labels={meta.league.zoneLabels}
            />
          </div>
        </section>
      ) : null}

      <section className="section shell">
        <div className="grid grid-2">
          {detail.official ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2 className="card-title">Eficiencia</h2>
                  <p className="card-note" style={{ margin: "4px 0 0" }}>
                    Avanzadas oficiales de la Euroliga, en percentil frente a su puesto.
                  </p>
                </div>
              </div>
              <PercentileStrip official={detail.official} />
            </div>
          ) : null}

          <div className="card">
            <div className="card-head">
              <div>
                <h2 className="card-title">Próximos partidos</h2>
                <p className="card-note" style={{ margin: "4px 0 0" }}>
                  Lo que concede cada rival a los{" "}
                  {(POSITION_PLURAL[player.position ?? ""] ?? "jugadores").toLowerCase()}, frente a
                  la media de la liga.
                </p>
              </div>
            </div>
            {detail.fixtures.length ? (
              <ul className="fixture-list">
                {detail.fixtures.map((fixture) => {
                  const rival = getTeam(fixture.opponent);
                  const key = (player.position ?? "all") as "G" | "F" | "C" | "all";
                  const index = rival?.allowed?.index?.[key] ?? null;
                  return (
                    <li key={`${fixture.round}-${fixture.opponent}`}>
                      <span>
                        <strong>J{fixture.round}</strong>{" "}
                        <span className="muted">{fixture.home ? "vs" : "@"}</span>{" "}
                        {rival?.short ?? fixture.opponent}
                      </span>
                      <span className="fixture-side">
                        {index !== null ? (
                          <span
                            className={`fixture-allowed seq-${sequentialClass(index)}`}
                            title={`Concede ${num(rival?.allowed?.[key] ?? null)} pts fantasy por partido a este puesto`}
                          >
                            {Math.round((index - 1) * 100) === 0
                              ? "0 %"
                              : `${index >= 1 ? "+" : "−"}${Math.abs(Math.round((index - 1) * 100))} %`}
                          </span>
                        ) : null}
                        <span className="muted num">{dateShort(fixture.date)}</span>
                      </span>
                    </li>
                  );
                })}
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
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div className="card-title">Rol y recorrido</div>
            </div>
            <dl className="fact-list">
              <Row
                label="Minutos últimos 5"
                value={`${num(perf.minutesRecent)} (${signed(perf.minutesTrend)})`}
              />
              <Row
                label="Cuota de minutos del equipo"
                value={percent(perf.minutesShareRecent, 1)}
              />
              <Row label="Titularidades" value={percent(perf.startedRate)} />
              <Row label="Partidos sin jugar" value={percent(perf.dnpRate)} />
              <Row label="Puntos fantasy por minuto" value={num(perf.fpPerMin, 2)} />
              <Row
                label="Suelo / techo"
                value={`${num(perf.fpFloor)} — ${num(perf.fpCeiling)}`}
              />
              <Row label="Desviación típica" value={`${num(perf.fpStd)} pts`} />
            </dl>
          </div>

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
        </div>
      </section>

      <section className="section shell">
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

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function Orb({ player, spec }: { player: Player; spec: OrbSpec }) {
  if (!usable(spec.value)) return null;

  const ratio = spec.polarity ? null : percentileOf(player, spec.key);
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const group = (POSITION_PLURAL[player.position ?? ""] ?? "jugadores").toLowerCase();
  const title = spec.polarity
    ? `${signed(spec.value)} de diferencial medio con él en pista`
    : pct === null
      ? `${num(spec.value)} ${spec.label.toLowerCase()} por partido`
      : `${num(spec.value)} ${spec.label.toLowerCase()} por partido · mejor que el ${pct} % de los ${group}`;

  return (
    <div className={`orb${spec.polarity ? " is-polarity" : ""}`} title={title}>
      <svg className="orb-ring" viewBox="0 0 120 120" aria-hidden>
        <circle className="orb-ring-bg" cx="60" cy="60" r="54" />
        {pct !== null ? (
          <circle
            className="orb-ring-fg"
            cx="60"
            cy="60"
            r="54"
            style={{ "--dash": pct } as CSSProperties}
          />
        ) : null}
      </svg>
      <div className="orb-body">
        <span className="orb-value num">
          {spec.polarity ? signed(spec.value) : num(spec.value)}
          {spec.unit ? <em>{spec.unit}</em> : null}
        </span>
        <span className="orb-label">{spec.label}</span>
      </div>
      {pct !== null ? <span className="orb-pct num">p{pct}</span> : null}
    </div>
  );
}

function BandItem({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">
        {value}
        {unit ? <em>{unit}</em> : null}
      </dd>
      {note ? <span className="num">{note}</span> : null}
    </div>
  );
}

/** "mejor que el 84 %" dicho en dos caracteres. Null cuando el grupo de
 *  comparación es demasiado pequeño para que el percentil signifique algo. */
function pctNote(player: Player, key: PercentileKey): string | null {
  const ratio = percentileOf(player, key);
  return ratio === null ? null : `p${Math.round(ratio * 100)}`;
}

/** El censo da "APELLIDO, NOMBRE": el nombre de pila va encima y pequeño, y el
 *  apellido es el que ocupa la pantalla. Los que no cruzan con el censo solo
 *  traen el nombre del mercado, ya abreviado ("M. Jaiteh"), y ahí la inicial
 *  hace de nombre de pila. */
function splitName(player: Player): { given: string; surname: string } {
  const raw = player.name ?? player.marketName;
  if (raw && raw.includes(",")) {
    const [surnameRaw, givenRaw] = raw.split(",");
    const given = givenRaw?.trim() ? prettyName(givenRaw.trim()) : "";
    return { given, surname: prettyName(surnameRaw?.trim() ?? "") };
  }
  const pretty = displayName(player);
  const parts = pretty.split(" ");
  if (parts.length < 2) return { given: "", surname: pretty };
  return { given: parts[0] ?? "", surname: parts.slice(1).join(" ") };
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
