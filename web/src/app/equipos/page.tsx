/** Equipos: la clasificación.
 *
 *  Antes era una tabla de ratings con el calendario escrito como "vs OLY · @ MAD".
 *  Ahora es una clasificación que se lee como tal —balance, diferencial,
 *  ataque, defensa, ritmo y a quién le toca— y cada fila abre la ficha del club.
 *
 *  Hasta que se juegue la jornada 1, el orden sale del diferencial de eficiencia
 *  de la temporada anterior. Un club sin histórico va al final y lo dice, en vez
 *  de pintar un cero que parecería un equipo malísimo.
 */
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getTeam, meta, teams } from "@/lib/data";
import { num, signed } from "@/lib/format";
import type { Team } from "@/lib/types";

export const metadata: Metadata = {
  title: "Equipos",
  description:
    "Clasificación de los 20 clubes de la EuroLeague: balance, diferencial, ataque, defensa, ritmo y próximo rival.",
};

export default function TeamsPage() {
  const ranked = [...teams].sort(byNetRating);
  const withHistory = teams.filter((team) => team.box).length;
  const isBaseline = meta.performanceSource.isBaseline;

  return (
    <section className="section shell">
      <header className="eq-head">
        <p className="eq-eyebrow">
          <i aria-hidden /> {teams.length} clubes
        </p>
        <h1>Quién gana, quién anota y a quién le toca.</h1>
        <p className="lede">
          {isBaseline
            ? "Ordenados por diferencial de eficiencia de la 2025-26, que es lo que hay hasta que se juegue la jornada 1. Cuando empiece, este orden pasa a ser el de esta temporada."
            : "Ordenados por diferencial de eficiencia de esta temporada: puntos a favor menos puntos en contra por cada 100 posesiones."}
        </p>
      </header>

      <div className="eq-standings">
        {/* La cabecera es solo visual. Cada fila es un enlace a la ficha del
            club; convertirla en tabla ARIA haría que dejara de anunciarse como
            enlace, que es lo único que hace. */}
        <div className="eq-row eq-thead" aria-hidden>
          <span className="num">#</span>
          <span>Equipo</span>
          <span className="num">Balance</span>
          <span className="num">Dif.</span>
          <span className="num eq-wide">Ataque</span>
          <span className="num eq-wide">Defensa</span>
          <span className="num eq-wide">Ritmo</span>
          <span className="num eq-wide">Próximo</span>
        </div>

        <ol className="eq-list">
          {ranked.map((team, index) => {
            const box = team.box;
            const next = team.fixtures[0];
            const rival = next ? getTeam(next.opponent) : undefined;
            return (
              <li key={team.code}>
                <Link href={`/equipos/${team.code}`} className="eq-row">
                  <span className="eq-pos num">{index + 1}</span>
                  <span className="eq-club-cell">
                    <Crest team={team} size={24} />
                    <span className="eq-club-text">
                      <span className="eq-name">{team.short ?? team.name ?? team.code}</span>
                      {/* En móvil no hay columna "Próximo": el rival baja bajo el nombre. */}
                      {next ? (
                        <span className="eq-next-inline">
                          {rival ? <Crest team={rival} size={14} /> : null}
                          {next.home ? "vs" : "@"} {rival?.short ?? next.opponent}
                        </span>
                      ) : null}
                    </span>
                  </span>

                  {box ? (
                    <>
                      <span className="num">
                        {num(box.wins, 0)}-{num(box.losses, 0)}
                      </span>
                      <span className={`num eq-net ${toneOf(box.netRating)}`}>
                        {signed(box.netRating)}
                      </span>
                      <span className="num eq-wide">{num(box.offRating)}</span>
                      <span className="num eq-wide">{num(box.defRating)}</span>
                      <span className="num eq-wide">{num(box.pace)}</span>
                    </>
                  ) : (
                    <>
                      <span className="num eq-nodata">—</span>
                      <span className="num eq-nodata">sin histórico</span>
                      <span className="num eq-wide eq-nodata">—</span>
                      <span className="num eq-wide eq-nodata">—</span>
                      <span className="num eq-wide eq-nodata">—</span>
                    </>
                  )}

                  <span className="eq-wide">
                    {next ? (
                      <span className="eq-next">
                        {rival ? <Crest team={rival} size={17} /> : null}
                        <b>{rival?.short ?? next.opponent}</b>
                        <i>{next.home ? "casa" : "fuera"}</i>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="card-note" style={{ marginTop: 14, maxWidth: "78ch" }}>
        Ataque y defensa son puntos por 100 posesiones; el ritmo, posesiones por partido.
        Reconstruidos desde los boxscores oficiales de {withHistory} clubes.{" "}
        <Link href="/metodologia">Cómo se calcula</Link>.
      </p>
    </section>
  );
}

function Crest({ team, size }: { team: Team; size: number }) {
  if (!team.crest) return <span className="eq-crest-empty" style={{ width: size, height: size }} />;
  return <Image className="eq-crest" src={team.crest} alt="" width={size} height={size} />;
}

/** Con histórico primero, por diferencial; sin histórico, al final. */
function byNetRating(a: Team, b: Team): number {
  const an = a.box?.netRating;
  const bn = b.box?.netRating;
  if (typeof an !== "number" && typeof bn !== "number") return 0;
  if (typeof an !== "number") return 1;
  if (typeof bn !== "number") return -1;
  return bn - an;
}

function toneOf(value: number | null | undefined): string {
  if (typeof value !== "number") return "";
  return value >= 0 ? "is-pos" : "is-neg";
}
