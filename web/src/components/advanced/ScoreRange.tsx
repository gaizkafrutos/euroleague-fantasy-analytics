/** Rango de puntuación de la plantilla.
 *
 *  La proyección es una media; la jornada es una tirada. Esto enseña la
 *  horquilla: la banda clara cubre el 80 % de los casos (percentiles 10–90),
 *  la oscura el 50 % central, el punto es lo esperado y la muesca, el equipo
 *  óptimo. Se asume que cada jugador varía por su cuenta, así que el rango real
 *  es algo más ancho: los de un mismo club suben y bajan juntos.
 */
import type { CSSProperties } from "react";

import type { ScoreRange as Range } from "@/lib/advanced";
import { num } from "@/lib/format";

export default function ScoreRange({ range, optimal }: { range: Range; optimal: number | null }) {
  const lo = Math.min(range.p10, optimal ?? range.p10) * 0.92;
  const hi = Math.max(range.p90, optimal ?? range.p90) * 1.04;
  const at = (value: number) => `${((value - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `calc(${at(b)} - ${at(a)})`;

  return (
    <div className="srange">
      <div
        className="srange-track"
        role="img"
        aria-label={`Puntuación esperada ${num(range.mean)}; 8 de cada 10 jornadas entre ${num(range.p10)} y ${num(range.p90)}${optimal !== null ? `; el óptimo proyecta ${num(optimal)}` : ""}.`}
      >
        <span className="srange-outer" style={{ left: at(range.p10), width: width(range.p10, range.p90) } as CSSProperties} />
        <span className="srange-inner" style={{ left: at(range.p25), width: width(range.p25, range.p75) } as CSSProperties} />
        <span className="srange-dot" style={{ left: at(range.mean) }} />
        {optimal !== null ? (
          <span className="srange-opt" style={{ left: at(optimal) }}>
            <i>óptimo {num(optimal)}</i>
          </span>
        ) : null}
      </div>
      <div className="srange-axis num" aria-hidden>
        <span style={{ left: at(range.p10) }}>{num(range.p10, 0)}</span>
        <span style={{ left: at(range.mean) }} className="is-mean">
          {num(range.mean, 0)}
        </span>
        <span style={{ left: at(range.p90) }}>{num(range.p90, 0)}</span>
      </div>
      <p className="srange-read">
        8 de cada 10 jornadas, entre <b className="num">{num(range.p10, 0)}</b> y{" "}
        <b className="num">{num(range.p90, 0)}</b> puntos. La mitad de las veces, entre{" "}
        {num(range.p25, 0)} y {num(range.p75, 0)}.
      </p>
    </div>
  );
}
