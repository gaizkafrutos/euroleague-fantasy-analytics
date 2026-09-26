/** De dónde salen sus puntos fantasy.
 *
 *  Barras divergentes desde un eje central: lo que suma hacia la derecha, lo
 *  que resta hacia la izquierda. Es la pregunta que la media sola no contesta:
 *  dos jugadores de 15 puntos pueden ser uno que anota 22 y falla 9 tiros, y
 *  otro que vive del rebote y las faltas recibidas (que es más estable).
 *
 *  El signo lo dice la dirección; el color solo refuerza: violeta (la capa de
 *  fantasy) para lo que suma, gris para lo que resta.
 */
import { num, signed } from "@/lib/format";
import type { MixDetail, MixKey } from "@/lib/types";

const LABELS: Record<MixKey, string> = {
  points: "Puntos",
  rebounds: "Rebotes",
  assists: "Asistencias",
  steals: "Robos",
  blocks: "Tapones",
  foulsDrawn: "Faltas recibidas",
  winBonus: "Bonus de victoria",
  missedFg: "Tiros fallados",
  missedFt: "Libres fallados",
  turnovers: "Pérdidas",
  foulsCommitted: "Faltas cometidas",
  blocksAgainst: "Tapones recibidos",
};

export default function FantasyMix({ mix }: { mix: MixDetail }) {
  const entries = (Object.entries(mix.parts) as Array<[MixKey, number]>).filter(
    ([, value]) => Math.abs(value) >= 0.05,
  );
  const positives = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const negatives = entries.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const plus = positives.reduce((sum, [, v]) => sum + v, 0);
  const minus = negatives.reduce((sum, [, v]) => sum + v, 0);
  const total = plus + minus;
  // Misma escala a los dos lados: si no, una pérdida parecería tan grande
  // como un punto.
  const reach = Math.max(...entries.map(([, v]) => Math.abs(v)), 1);
  const scoring = positives.find(([key]) => key === "points")?.[1] ?? 0;
  const share = plus > 0 ? scoring / plus : 0;

  return (
    <div className="mix">
      <p className="mix-read">
        {share >= 0.6
          ? "Vive del tiro: más de la mitad de lo que suma son sus puntos."
          : share <= 0.4
            ? "Suma sin necesidad de anotar: rebote, pase y faltas pesan más que sus puntos."
            : "Reparto equilibrado entre anotar y el resto del juego."}
      </p>

      <ul className="mix-rows">
        {[...positives, ...negatives].map(([key, value]) => (
          <li key={key} className={value > 0 ? "is-plus" : "is-minus"}>
            <span className="mix-label">{LABELS[key]}</span>
            <span className="mix-axis" aria-hidden>
              <span
                className="mix-bar"
                style={{ width: `${(Math.abs(value) / reach) * 50}%` }}
              />
            </span>
            <span className="mix-value num">{signed(value)}</span>
          </li>
        ))}
      </ul>

      <dl className="mix-total">
        <div>
          <dt>Suma</dt>
          <dd className="num">{signed(plus)}</dd>
        </div>
        <div>
          <dt>Resta</dt>
          <dd className="num">{signed(minus)}</dd>
        </div>
        <div>
          <dt>Por partido</dt>
          <dd className="num is-total">{num(total)}</dd>
        </div>
      </dl>
    </div>
  );
}
