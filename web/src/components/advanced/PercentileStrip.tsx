/** Avanzadas oficiales como tiras de percentil (a la manera de Baseball Savant).
 *
 *  Una fila por métrica, todas sobre la misma escala 0–100: el círculo cae en
 *  su percentil dentro de su puesto y lleva el número dentro. El color dice
 *  lo mismo que la posición (frío = por debajo, gris = en la media, cálido =
 *  por encima), así que nunca es el único canal. En las métricas donde menos
 *  es mejor (pérdidas) el percentil ya viene dado la vuelta.
 *
 *  Sin radar: con siete ejes, el orden y el área del polígono se inventan
 *  relaciones que no están en los datos.
 */
import { percent } from "@/lib/format";
import { percentileClass, seasonLabel } from "@/lib/advanced";
import type { OfficialDetail } from "@/lib/types";

const POSITION_WORD: Record<string, string> = { G: "bases", F: "aleros", C: "pívots" };

export default function PercentileStrip({ official }: { official: OfficialDetail }) {
  const group = official.position ? POSITION_WORD[official.position] : "jugadores";
  return (
    <div className="pstrip">
      <div className="pstrip-scale" aria-hidden>
        <span />
        <span className="pstrip-scale-mid">
          <span>Peor</span>
          <span>Media</span>
          <span>Mejor</span>
        </span>
        <span />
      </div>
      <ul className="pstrip-rows">
        {official.metrics.map((metric) => {
          const pct = metric.percentile;
          const rounded = pct === null ? null : Math.round(pct * 100);
          const cls = percentileClass(pct);
          return (
            <li key={metric.key}>
              <span className="pstrip-label">
                {metric.label}
                {!metric.higherIsBetter ? <small> · menos es mejor</small> : null}
              </span>
              <span className="pstrip-track" aria-hidden>
                <span className="pstrip-mid" />
                {rounded !== null ? (
                  <span
                    className={`pstrip-dot div-${cls}`}
                    style={{ left: `${Math.max(3, Math.min(97, rounded))}%` }}
                  >
                    {rounded}
                  </span>
                ) : null}
              </span>
              <span className="pstrip-value num">{percent(metric.value, 1)}</span>
              <span className="sr-only">
                {rounded === null ? "sin percentil" : `percentil ${rounded} entre los ${group}`}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="pstrip-source">
        Percentil entre {official.poolSize} {group} con 10+ minutos · Euroliga{" "}
        {seasonLabel(official.season)}, {official.games} {official.games === 1 ? "partido" : "partidos"}
        {official.doubleDoubles ? ` · ${official.doubleDoubles} dobles-dobles` : ""}
      </p>
    </div>
  );
}
