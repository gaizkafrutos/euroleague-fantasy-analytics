/** Dos piezas de la ficha de club que salen de datos que antes no se usaban:
 *  los parciales por cuarto (calendario oficial) y los quintetos (jugada a
 *  jugada).
 */
import Link from "next/link";
import type { CSSProperties } from "react";

import { divergingClass, seasonLabel } from "@/lib/advanced";
import { num, signed } from "@/lib/format";
import type { QuarterSplit, TeamLineup } from "@/lib/types";

const QUARTERS = ["1.º", "2.º", "3.º", "4.º"];

/** Diferencial medio por cuarto: columnas divergentes desde el cero. La
 *  temporada anterior va como una muesca de referencia en la misma columna,
 *  para ver si el patrón se repite o es de una jornada. */
export function QuarterMargins({
  current,
  prior,
  currentSeason,
  priorSeason,
}: {
  current: QuarterSplit | null;
  prior: QuarterSplit | null;
  currentSeason: string;
  priorSeason: string;
}) {
  const main = current ?? prior;
  if (!main) return <p className="muted">Sin partidos todavía.</p>;
  const reference = current ? prior : null;
  const margins = main.for.map((value, i) => value - (main.against[i] ?? 0));
  const refMargins = reference ? reference.for.map((value, i) => value - (reference.against[i] ?? 0)) : null;
  const reach = Math.max(6, ...margins.map(Math.abs), ...(refMargins ?? []).map(Math.abs)) * 1.1;
  const pct = (value: number) => `${(Math.abs(value) / reach) * 50}%`;
  const best = margins.indexOf(Math.max(...margins));
  const worst = margins.indexOf(Math.min(...margins));

  return (
    <div className="qm">
      <p className="qm-read">
        {margins[best]! > 0 ? `Donde más saca: el ${QUARTERS[best]} cuarto (${signed(margins[best])}).` : "No gana ningún cuarto de media."}{" "}
        {margins[worst]! < 0 ? `Donde más cede: el ${QUARTERS[worst]} (${signed(margins[worst])}).` : ""}
      </p>
      <div className="qm-plot" role="img" aria-label={`Diferencial medio por cuarto: ${margins.map((m, i) => `${QUARTERS[i]} ${signed(m)}`).join(", ")}`}>
        {margins.map((margin, index) => {
          const cls = divergingClass(margin, 2);
          const ref = refMargins?.[index];
          return (
            <div key={QUARTERS[index]} className="qm-col">
              <span className="qm-area" aria-hidden>
                <span className="qm-zero" />
                <span
                  className={`qm-bar zone-div-${cls}${margin >= 0 ? " is-up" : " is-down"}`}
                  style={{ height: pct(margin) }}
                />
                {ref !== undefined ? (
                  <span
                    className="qm-ref"
                    style={{ [ref >= 0 ? "bottom" : "top"]: `calc(50% + ${pct(ref)})` } as CSSProperties}
                  />
                ) : null}
              </span>
              <span className="qm-value num">{signed(margin)}</span>
              <span className="qm-label">{QUARTERS[index]}</span>
            </div>
          );
        })}
      </div>
      <div className="chart-legend qm-legend">
        <span>
          <i className="legend-swatch zone-div-1" /> {seasonLabel(current ? currentSeason : priorSeason)} ·{" "}
          {main.games} {main.games === 1 ? "partido" : "partidos"}
        </span>
        {reference ? (
          <span>
            <i className="qm-ref-key" /> {seasonLabel(priorSeason)} · {reference.games} partidos
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Quintetos con más minutos y su diferencial por 100 posesiones. */
export function Lineups({ lineups }: { lineups: TeamLineup[] }) {
  if (!lineups.length) return <p className="muted">Aún no hay quintetos con dos minutos juntos.</p>;
  const reach = Math.max(10, ...lineups.map((l) => Math.abs(l.net ?? 0)));
  return (
    <table className="lineups">
      <caption className="sr-only">Quintetos más usados</caption>
      <thead>
        <tr>
          <th scope="col">Quinteto</th>
          <th scope="col" className="num">
            Min
          </th>
          <th scope="col" className="num">
            ± por 100
          </th>
        </tr>
      </thead>
      <tbody>
        {lineups.map((lineup) => (
          <tr key={lineup.players.join("-")}>
            <th scope="row">
              <span className="lineup-names">
                {lineup.names.map((name, i) => {
                  const id = lineup.ids[i];
                  return id ? (
                    <Link key={lineup.players[i]} href={`/jugador/${id}`}>
                      {name}
                    </Link>
                  ) : (
                    <span key={lineup.players[i]}>{name}</span>
                  );
                })}
              </span>
            </th>
            <td className="num">{num(lineup.minutes)}</td>
            <td className="num">
              <span className={`lineup-net${lineup.possessions < 15 ? " is-few" : ""}`} title={lineup.possessions < 15 ? "Menos de 15 posesiones: muestra demasiado corta" : undefined}>
                <span className="lineup-net-track" aria-hidden>
                  <span
                    className={`zone-div-${divergingClass(lineup.net, 5)}`}
                    style={{
                      width: `${(Math.abs(lineup.net ?? 0) / reach) * 50}%`,
                      [(lineup.net ?? 0) >= 0 ? "left" : "right"]: "50%",
                    }}
                  />
                </span>
                <b>{signed(lineup.net)}</b>
              </span>
              <small className="muted">
                {lineup.pointsFor}–{lineup.pointsAgainst}
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
