/** En pista: cuándo juega y qué pasa cuando está.
 *
 *  Sale del jugada a jugada, reconstruyendo quién estaba en pista cada segundo
 *  (los minutos cuadran con el boxscore a menos de 30 s en todos los jugadores
 *  de la J1).
 *
 *  Arriba, sus minutos por cuarto: dice si el entrenador lo guarda para el
 *  final o lo quema al principio, que es rotación y no talento.
 *  Abajo, el on/off: el diferencial de su equipo por cada 100 posesiones con él
 *  y sin él, sobre una misma recta con el cero marcado.
 */
import { num, percent, signed } from "@/lib/format";
import { seasonsLabel } from "@/lib/advanced";
import type { CourtDetail } from "@/lib/types";

const PERIODS = ["1.º", "2.º", "3.º", "4.º"];

export default function CourtRole({ court }: { court: CourtDetail }) {
  const periods = court.periodMinutes.slice(0, 4);
  const overtime = court.periodMinutes[4] ?? 0;
  const top = Math.max(...periods, 10);
  const { onNet, offNet, diff } = court.onOff;
  const reach = Math.max(20, Math.abs(onNet ?? 0), Math.abs(offNet ?? 0)) * 1.15;
  const at = (value: number) => `${50 + (value / reach) * 50}%`;
  const fewPoss = court.onOff.onPoss < 60;

  return (
    <div className="court-role">
      <div className="court-quarters" role="img" aria-label={`Minutos por cuarto: ${periods.map((m, i) => `${PERIODS[i]} ${num(m)}`).join(", ")}`}>
        {periods.map((minutes, index) => (
          <div key={PERIODS[index]} className="court-q">
            <span className="court-q-value num">{num(minutes)}</span>
            <span className="court-q-track" aria-hidden>
              <span style={{ height: `${Math.min(minutes / top, 1) * 100}%` }} />
            </span>
            <span className="court-q-label">{PERIODS[index]}</span>
          </div>
        ))}
      </div>
      <p className="court-caption">
        Minutos por cuarto
        {overtime >= 0.05 ? ` · ${num(overtime)} en prórrogas` : ""}. De 10 posibles.
      </p>

      <dl className="court-facts">
        <div>
          <dt>Final apretado</dt>
          <dd className="num">
            {num(court.clutchMinutes)} <small>min</small>
          </dd>
          <span>últimos 5′ a ±5 puntos</span>
        </div>
        <div>
          <dt>Uso</dt>
          <dd className="num">{percent(court.usage)}</dd>
          <span>posesiones que acaba él</span>
        </div>
      </dl>

      {onNet !== null && offNet !== null ? (
        <div className="onoff">
          <div className="onoff-head">
            <span>Su equipo por cada 100 posesiones</span>
            <b className={`num ${diff !== null && diff >= 0 ? "delta-up" : "delta-down"}`}>
              {signed(diff)} con él
            </b>
          </div>
          <div className="onoff-line" aria-hidden>
            <span className="onoff-zero" style={{ left: "50%" }} />
            <span
              className="onoff-link"
              style={{
                left: at(Math.min(onNet, offNet)),
                width: `${(Math.abs(onNet - offNet) / reach) * 50}%`,
              }}
            />
            <span className="onoff-dot is-off" style={{ left: at(offNet) }}>
              <i className="num">{signed(offNet)}</i>
              <em>sin él</em>
            </span>
            <span className="onoff-dot is-on" style={{ left: at(onNet) }}>
              <i className="num">{signed(onNet)}</i>
              <em>con él</em>
            </span>
          </div>
          <p className="sr-only">
            Con él en pista su equipo hace {signed(onNet)} por cada 100 posesiones; sin él,{" "}
            {signed(offNet)}.
          </p>
        </div>
      ) : null}

      <p className="court-source">
        {court.games} {court.games === 1 ? "partido" : "partidos"} · {seasonsLabel(court.seasons)}
        {fewPoss ? " · muestra aún corta: el on/off necesita semanas para estabilizarse" : ""}
      </p>
    </div>
  );
}
