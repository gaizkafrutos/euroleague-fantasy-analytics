/** Ficha de club.
 *
 *  Lo que la clasificación no cabe en una fila: los cuatro factores con su
 *  percentil, ataque y defensa por posesión, los cinco próximos rivales con
 *  lo duro que es cada uno, y la plantilla del Fantasy con precio y proyección.
 *
 *  Como en la ficha de jugador, el color del club entra en el halo y en las
 *  barras; el resto es el sistema de siempre.
 */
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { Lineups, QuarterMargins } from "@/components/advanced/TeamGame";
import { sequentialClass } from "@/lib/advanced";
import { getTeam, meta, players, teams } from "@/lib/data";
import { credits, dateShort, displayName, num, signed } from "@/lib/format";
import type { Player, TeamBox } from "@/lib/types";

export function generateStaticParams() {
  return teams.map((team) => ({ code: team.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const team = getTeam(code);
  if (!team) return { title: "Equipo no encontrado" };
  const name = team.name ?? team.code;
  return {
    title: name,
    description: `${name}: balance, cuatro factores, ataque y defensa, próximos rivales y plantilla del EuroLeague Fantasy Challenge.`,
  };
}

const POS_WORD = { G: "Bases", F: "Aleros", C: "Pívots" } as const;

/** Los clubes con histórico: el grupo contra el que se calcula cada percentil. */
const withBox: TeamBox[] = teams.map((team) => team.box).filter((box): box is TeamBox => !!box);

export default async function TeamPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const team = getTeam(code);
  if (!team) notFound();

  const box = team.box ?? null;
  const isBaseline = meta.performanceSource.isBaseline;
  const season = isBaseline ? "la 2025-26" : "esta temporada";
  const roster = players.filter((player) => player.club === team.code);

  const clubStyle = {
    "--club": team.colors?.halo ?? "var(--surface-3)",
    "--stat-dark": team.colors?.statDark ?? "var(--accent)",
    "--stat-light": team.colors?.statLight ?? "var(--accent)",
  } as CSSProperties;

  return (
    <div className="eq-club shell" style={clubStyle}>
      <Link href="/equipos" className="crumb">
        <span aria-hidden>←</span> Todos los equipos
      </Link>

      <section className="eq-hero">
        {team.crest ? (
          <Image
            className="eq-hero-crest"
            src={team.crest}
            alt=""
            width={84}
            height={84}
            priority
          />
        ) : null}
        <h1>{team.name ?? team.code}</h1>
        <p className="eq-hero-sub">
          {team.country ? `${team.country} · ` : ""}
          {roster.length} fichas en el Fantasy
        </p>
        <div className="eq-pills num">
          {box ? (
            <>
              <span className="eq-pill">
                Balance{" "}
                <b>
                  {num(box.wins, 0)}-{num(box.losses, 0)}
                </b>
              </span>
              <span className="eq-pill">
                Diferencial <b>{signed(box.netRating)}</b>
              </span>
              <span className="eq-pill">
                {num(box.ppg)} <b>a favor</b>
              </span>
              <span className="eq-pill">
                {num(box.papg)} <b>en contra</b>
              </span>
            </>
          ) : (
            <span className="eq-pill">Sin histórico: no hay partidos suyos en {season}</span>
          )}
        </div>
      </section>

      {box ? (
        <>
          <section className="eq-section">
            <div className="eq-section-head">
              <h2>Los cuatro factores</h2>
              <p>Percentil entre los {withBox.length} clubes con histórico.</p>
            </div>
            <dl className="eq-factors">
              <Factor label="Tiro (eFG)" value={box.efg} unit="%" pct={pctOf(box, "efg")} />
              <Factor
                label="Pérdidas"
                value={box.tovRate}
                unit="%"
                pct={pctOf(box, "tovRate", true)}
                note="menos es mejor"
              />
              <Factor
                label="Rebote ofensivo"
                value={box.orbRate}
                unit="%"
                pct={pctOf(box, "orbRate")}
              />
              <Factor
                label="Tiros libres"
                value={box.ftRate}
                unit="%"
                pct={pctOf(box, "ftRate")}
                note="por cada 100 tiros"
              />
            </dl>
          </section>

          <section className="eq-section">
            <div className="eq-section-head">
              <h2>Ataque y defensa</h2>
              <p>Por 100 posesiones, sobre {season}.</p>
            </div>
            <dl className="eq-rows">
              <Line
                label="Ataque"
                value={num(box.offRating)}
                note="pts por 100 posesiones"
                pct={pctOf(box, "offRating")}
              />
              <Line
                label="Defensa"
                value={num(box.defRating)}
                note="pts recibidos por 100"
                pct={pctOf(box, "defRating", true)}
              />
              <Line
                label="Ritmo"
                value={num(box.pace)}
                note="posesiones por partido"
                pct={pctOf(box, "pace")}
              />
              <Line label="Asistencias" value={num(box.astPerGame)} note="por partido" />
              <Line label="Triples" value={`${num(box.threeRate)} %`} note="de sus tiros" />
            </dl>
            <p className="eq-foot-note">
              En defensa, como en pérdidas, el percentil ya está dado la vuelta: más alto es mejor.
              En ritmo no hay mejor ni peor, solo más rápido.
            </p>
          </section>
        </>
      ) : null}

      {team.quarters && (team.quarters.current || team.quarters.prior) ? (
        <section className="eq-section">
          <div className="eq-section-head">
            <h2>Por cuartos</h2>
            <p>Diferencial medio en cada cuarto, desde los parciales oficiales.</p>
          </div>
          <QuarterMargins {...team.quarters} />
        </section>
      ) : null}

      {team.lineups ? (
        <section className="eq-section">
          <div className="eq-section-head">
            <h2>Quintetos</h2>
            <p>
              Los cinco que más minutos comparten esta temporada, y cómo le va al equipo con
              ellos en pista por cada 100 posesiones.
            </p>
          </div>
          <Lineups lineups={team.lineups} />
        </section>
      ) : null}

      {team.allowed ? (
        <section className="eq-section">
          <div className="eq-section-head">
            <h2>Lo que concede</h2>
            <p>
              Puntos fantasy por partido que sacan contra él los rivales de cada puesto. Más
              violeta, más regala: buen rival para tus jugadores.
            </p>
          </div>
          <ul className="allowed">
            {(["G", "F", "C"] as const).map((pos) => {
              const value = team.allowed?.[pos] ?? null;
              const index = team.allowed?.index?.[pos] ?? null;
              const league = meta.league?.allowed?.[pos] ?? null;
              return (
                <li key={pos}>
                  <span className="allowed-label">{POS_WORD[pos]}</span>
                  <span className="allowed-track" aria-hidden>
                    <span
                      className={`seq-${sequentialClass(index)}`}
                      style={{ width: `${Math.min(((value ?? 0) / ((league ?? 1) * 1.6)) * 100, 100)}%` }}
                    />
                    {league ? (
                      <i className="allowed-league" style={{ left: `${(1 / 1.6) * 100}%` }} />
                    ) : null}
                  </span>
                  <span className="allowed-value num">
                    {num(value)}
                    <small>
                      {index === null ? "" : ` ${index >= 1 ? "+" : "−"}${Math.abs(Math.round((index - 1) * 100))} %`}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="eq-foot-note">
            La muesca es la media de la liga ({num(meta.league?.allowed?.G)} a bases,{" "}
            {num(meta.league?.allowed?.F)} a aleros, {num(meta.league?.allowed?.C)} a pívots).
            Con pocas jornadas se encoge hacia el año pasado.
          </p>
        </section>
      ) : null}

      <section className="eq-section">
        <div className="eq-section-head">
          <h2>Próximos cinco</h2>
          <p>
            {typeof team.difficulty === "number"
              ? `Dificultad de los tres primeros: ${num(team.difficulty, 0)} sobre 100.`
              : "El borde marca lo duro que es el rival."}
          </p>
        </div>
        {team.fixtures.length ? (
          <ol className="eq-fixtures">
            {team.fixtures.map((fixture) => {
              const rival = getTeam(fixture.opponent);
              const rivalNet = rival?.box?.netRating;
              return (
                <li
                  key={`${fixture.round}-${fixture.opponent}`}
                  className={`eq-fx ${hardness(rivalNet)}`}
                >
                  <span className="eq-fx-round">
                    Jornada {fixture.round} · {fixture.home ? "en casa" : "fuera"}
                  </span>
                  <Link href={`/equipos/${fixture.opponent}`} className="eq-fx-rival">
                    {rival?.crest ? (
                      <Image src={rival.crest} alt="" width={22} height={22} />
                    ) : null}
                    <b>{rival?.short ?? fixture.opponent}</b>
                  </Link>
                  <span className="eq-fx-date num">
                    {dateShort(fixture.date)}
                    {typeof rivalNet === "number"
                      ? ` · dif. ${signed(rivalNet)}`
                      : " · sin histórico"}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted">Sin calendario disponible.</p>
        )}
        <p className="eq-foot-note">
          Borde rojo: rival con más de +3 de diferencial. Verde: por debajo de −3. El resto, neutro.
        </p>
      </section>

      <section className="eq-section">
        <div className="eq-section-head">
          <h2>Plantilla</h2>
          <p>Precio del Fantasy y proyección para la jornada.</p>
        </div>
        <Roster roster={roster} />
      </section>

      <p className="provenance">
        Índices reconstruidos desde los boxscores oficiales de {season}.{" "}
        <Link href="/metodologia">Cómo se calcula</Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Factor({
  label,
  value,
  unit,
  pct,
  note,
}: {
  label: string;
  value: number | null;
  unit?: string;
  pct: number | null;
  note?: string;
}) {
  return (
    <div className="eq-factor">
      <dt>{label}</dt>
      <dd className="num">
        {num(value)}
        {unit ? <em>{unit}</em> : null}
      </dd>
      {pct !== null ? (
        <>
          <div className="eq-track" aria-hidden>
            <div className="eq-fill" style={{ "--p": pct } as CSSProperties} />
          </div>
          <span className="eq-cap num">
            p{pct}
            {note ? ` · ${note}` : ""}
          </span>
        </>
      ) : note ? (
        <span className="eq-cap">{note}</span>
      ) : null}
    </div>
  );
}

function Line({
  label,
  value,
  note,
  pct,
}: {
  label: string;
  value: string;
  note: string;
  pct?: number | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num">
        {value}
        <small>
          {note}
          {typeof pct === "number" ? ` · p${pct}` : ""}
        </small>
      </dd>
    </div>
  );
}

const GROUPS: Array<{ key: "G" | "F" | "C" | "E"; label: string }> = [
  { key: "G", label: "Bases" },
  { key: "F", label: "Aleros" },
  { key: "C", label: "Pívots" },
  { key: "E", label: "Entrenador" },
];

function Roster({ roster }: { roster: Player[] }) {
  const groupOf = (player: Player) => (player.isCoach ? "E" : player.position);
  const byPrice = (a: Player, b: Player) => (b.price ?? 0) - (a.price ?? 0);

  return (
    <div className="eq-squad">
      {GROUPS.map(({ key, label }) => {
        const members = roster.filter((player) => groupOf(player) === key).sort(byPrice);
        if (!members.length) return null;
        return (
          <div key={key} className={`eq-grp pos-${key}`}>
            <h3>
              {label} · {members.length}
            </h3>
            <ul>
              {members.map((player) => (
                <li key={player.id}>
                  {player.isCoach ? (
                    <span className="eq-grp-name">{displayName(player)}</span>
                  ) : (
                    <Link href={`/jugador/${player.id}`} className="eq-grp-name">
                      {displayName(player)}
                    </Link>
                  )}
                  <span className="eq-grp-price num">{credits(player.price)}</span>
                  {hasProjection(player) ? (
                    <span className="eq-grp-proj num">{num(player.projectedFp)}</span>
                  ) : (
                    <span className="eq-grp-proj is-none">sin proy.</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- cálculos */

type BoxKey = "efg" | "tovRate" | "orbRate" | "ftRate" | "offRating" | "defRating" | "pace";

/** Percentil 0–100 entre los clubes con histórico, con los empates a medias.
 *  Con `lowerIsBetter` se da la vuelta, para que un número alto siempre
 *  signifique "mejor que la mayoría". */
function pctOf(box: TeamBox, key: BoxKey, lowerIsBetter = false): number | null {
  const value = box[key];
  if (typeof value !== "number") return null;
  const pool = withBox.map((other) => other[key]).filter((v): v is number => typeof v === "number");
  if (pool.length < 6) return null;
  let below = 0;
  let equal = 0;
  for (const candidate of pool) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }
  const rank = (below + equal / 2) / pool.length;
  return Math.round((lowerIsBetter ? 1 - rank : rank) * 100);
}

/** Desde el 26 sept la proyección se apoya en la temporada anterior (o en el
 *  precio) mientras no hay partidos: un 0,0 solo queda para quien de verdad
 *  no tiene nada detrás. */
function hasProjection(player: Player): boolean {
  if (typeof player.projectedFp !== "number") return false;
  return player.isCoach || player.projectedFp > 0;
}

/** Lo duro que es un rival, por su diferencial. */
function hardness(net: number | null | undefined): string {
  if (typeof net !== "number") return "is-neutral";
  if (net > 3) return "is-hard";
  if (net < -3) return "is-easy";
  return "is-neutral";
}
