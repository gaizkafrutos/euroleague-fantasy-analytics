/** ¿Sube o baja de precio?
 *
 *  Una sola línea de puntos fantasy con tres marcas encima: el rango probable
 *  de su puntuación (percentiles 25–75), su proyección y el umbral con el que
 *  el precio no se mueve. Si el punto queda a la derecha del umbral, sube.
 *
 *  Es una gráfica de bala (Few) en horizontal: se lee en un segundo y cabe en
 *  un móvil. HTML y no SVG a propósito: el texto conserva su tamaño real a
 *  cualquier ancho, en vez de encogerse con un viewBox.
 */
import type { CSSProperties } from "react";

import { credits, num, percent, signed } from "@/lib/format";
import type { Outlook } from "@/lib/types";

interface Props {
  outlook: Outlook;
  projection: number;
  price: number;
  /** De baja: la proyección no se va a cumplir esta jornada. */
  out?: boolean;
}

export default function PriceOutlook({ outlook, projection, price, out = false }: Props) {
  const { breakEven, floor, ceiling, riseProb, expectedChange } = outlook;
  const lo = Math.min(0, floor, breakEven) - 2;
  const hi = Math.max(ceiling, breakEven, projection) * 1.12 + 2;
  const at = (value: number) => `${((value - lo) / (hi - lo)) * 100}%`;
  const rises = expectedChange >= 0.05;
  const falls = expectedChange <= -0.05;
  const change = Math.round(expectedChange * 10) / 10;

  const headline = out
    ? "De baja: esta jornada no va a puntuar y su precio lo acusará."
    : rises
      ? `Si rinde lo esperado, sube ${credits(Math.abs(change))}.`
      : falls
        ? `Si rinde lo esperado, baja ${credits(Math.abs(change))}.`
        : "Si rinde lo esperado, su precio se queda donde está.";

  const summary =
    `Proyecta ${num(projection)} puntos (rango probable ${num(floor)}–${num(ceiling)}); ` +
    `necesita ${num(breakEven)} para mantener sus ${credits(price)}. ` +
    `Probabilidad de superarlo: ${percent(riseProb)}.`;

  return (
    <div className={`outlook${rises && !out ? " is-up" : falls || out ? " is-down" : ""}`}>
      <p className="outlook-headline">{headline}</p>

      <figure className="outlook-figure" aria-label={summary}>
        <div className="outlook-track" aria-hidden>
          <span className="outlook-side is-down" style={{ width: at(breakEven) }} />
          <span
            className="outlook-band"
            style={{ left: at(floor), width: `calc(${at(ceiling)} - ${at(floor)})` } as CSSProperties}
            title={`Rango probable: ${num(floor)}–${num(ceiling)} puntos`}
          />
          <span className="outlook-threshold" style={{ left: at(breakEven) }}>
            <b className="num">{num(breakEven)}</b>
            <i>umbral</i>
          </span>
          <span
            className={`outlook-dot${out ? " is-out" : ""}`}
            style={{ left: at(projection) }}
            title={`Proyección: ${num(projection)} puntos`}
          >
            <b className="num">{num(projection)}</b>
          </span>
        </div>
        <div className="outlook-scale" aria-hidden>
          <span>← pierde valor</span>
          <span>se revaloriza →</span>
        </div>
      </figure>

      <dl className="outlook-facts">
        <div>
          <dt>Variación</dt>
          <dd className="num">{out ? "—" : `${signed(change)} cr`}</dd>
        </div>
        <div>
          <dt>Prob. de subir</dt>
          <dd className="num">{out ? "—" : percent(riseProb)}</dd>
        </div>
        <div>
          <dt>Umbral / precio</dt>
          <dd className="num">{num(breakEven / price, 2)}×</dd>
        </div>
      </dl>
    </div>
  );
}
