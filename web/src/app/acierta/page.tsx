/** ¿Acierta HoopIQ? El historial de lo que publicó la web frente a lo que pasó.
 *
 *  Todo sale de `meta.modelBacktest.published`, que genera `efa backtest` con
 *  las predicciones archivadas antes de cada jornada (efa.published). Aquí no
 *  se copia ninguna cifra a mano: si una jornada se reevalúa, la página cambia
 *  sola en el siguiente build.
 */
import type { Metadata } from "next";
import Link from "next/link";

import LineupRounds, { type LineupRound } from "@/components/charts/LineupRounds";
import PlayCalibration, { type CalibrationRow } from "@/components/charts/PlayCalibration";
import RoundBias from "@/components/charts/RoundBias";
import RoundLines from "@/components/charts/RoundLines";
import { StatTile } from "@/components/ui/primitives";
import { meta } from "@/lib/data";
import { dateTime, num, percent, signed } from "@/lib/format";

export const metadata: Metadata = {
  title: "¿Acierta HoopIQ?",
  description:
    "Lo que proyectó la web antes de cada jornada frente a lo que pasó: error, sesgo, orden del mercado, probabilidad de jugar y el once óptimo.",
};

/** Estados del parte, en el orden en que se leen (de más a menos seguro). */
const STATES: Array<[string, string]> = [
  ["sin parte", "Sin parte"],
  ["probable", "Probable"],
  ["doubt", "Duda"],
  ["out", "Baja"],
  ["nunca convocado", "Nunca convocado"],
];

const MODEL_COLOR = "var(--brand)";
const BASE_COLOR = "var(--ink-3)";

export default function AccuracyPage() {
  const backtest = meta.modelBacktest ?? null;
  const published = backtest?.published;
  const rounds = [...(published?.rounds ?? [])].sort((a, b) => a.round - b.round);

  if (!published || rounds.length < 2) {
    return (
      <section className="section shell">
        <h1>¿Acierta HoopIQ?</h1>
        <p className="lede">
          Antes de cada jornada se guarda lo que publica la web para compararlo con lo que pasa. Con
          menos de dos jornadas evaluadas todavía no hay historial que enseñar.
        </p>
      </section>
    );
  }

  const total = published.total;
  const numbers = rounds.map((r) => r.round);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const lineups: LineupRound[] = rounds
    .filter((r) => r.lineup)
    .map((r) => ({ round: r.round, projected: r.lineup!.projected, real: r.lineup!.real, best: r.lineup!.best }));
  const calibration: CalibrationRow[] = STATES.flatMap(([key, label]) => {
    const row = total.playProb?.[key];
    return row ? [{ key, label, n: row.n, predicted: row.predicted, real: row.real }] : [];
  });

  const beatMean = rounds.filter((r) => r.model.mae < r.mean.mae).length;
  const overRounds = rounds.filter((r) => r.model.bias > 0).length;
  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const lineupReal = avg(lineups.map((l) => l.real));
  const lineupProjected = avg(lineups.map((l) => l.projected));
  const lineupBest = avg(lineups.flatMap((l) => (l.best !== null ? [l.best] : [])));
  const regulars = total.playProb?.["sin parte"];

  return (
    <section className="section shell">
      <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
        <h1>¿Acierta HoopIQ?</h1>
        <p className="lede">
          Antes del primer partido de cada jornada se guarda la proyección que enseña la web, de todo
          el mercado y con la probabilidad de jugar dentro. Cuando se juega, se compara con lo que
          pasó. Quien no juega cuenta como 0, igual que en el Fantasy.
        </p>
        <span className="eyebrow">
          Jornadas {first} a {last} · {num(total.n, 0)} predicciones de jugador
        </span>
      </div>

      <div className="grid grid-4 ac-figures">
        <StatTile
          label="Error medio por jugador"
          value={`${num(total.model.mae ?? null, 2)} pts`}
          sub={`Con la media de cada jugador, ${num(total.mean.mae ?? null, 2)}. Mejor en ${beatMean} de ${rounds.length} jornadas.`}
        />
        <StatTile
          label="Orden del mercado"
          value={num(total.model.spearman ?? null, 2)}
          sub={`Spearman; 1 es el orden perfecto. Con la media, ${num(total.mean.spearman ?? null, 2)}.`}
        />
        <StatTile
          label="Sesgo"
          value={`${signed(total.model.bias ?? null, 2)} pts`}
          sub={`Positivo: proyectó de más. Pasó en ${overRounds} de ${rounds.length} jornadas.`}
        />
        {lineups.length ? (
          <StatTile
            label="Once óptimo"
            value={`${num(lineupReal, 0)} pts`}
            sub={`Por jornada, frente a ${num(lineupProjected, 0)} proyectados. El mejor posible, ${num(lineupBest, 0)}.`}
          />
        ) : null}
      </div>

      <div className="grid ac-charts">
        <div className="card ac-chart">
          <h2 className="card-title">Error medio por jornada</h2>
          <p className="card-note">
            Puntos de diferencia, por jugador, entre lo proyectado y lo que hizo. Cuanto más bajo,
            mejor.
          </p>
          <RoundLines
            rounds={numbers}
            ariaLabel="Error medio por jornada: HoopIQ frente a la media de cada jugador"
            series={[
              { key: "model", label: "HoopIQ", color: MODEL_COLOR, values: rounds.map((r) => r.model.mae) },
              { key: "mean", label: "Media de cada jugador", color: BASE_COLOR, values: rounds.map((r) => r.mean.mae) },
            ]}
          />
        </div>

        <div className="card ac-chart">
          <h2 className="card-title">Orden del mercado</h2>
          <p className="card-note">
            Si quien sale arriba en la proyección es quien más puntúa (Spearman). Para fichar importa
            más el orden que la cifra exacta. Cuanto más alto, mejor.
          </p>
          <RoundLines
            rounds={numbers}
            ariaLabel="Spearman por jornada: HoopIQ frente a la media de cada jugador"
            series={[
              { key: "model", label: "HoopIQ", color: MODEL_COLOR, values: rounds.map((r) => r.model.spearman) },
              { key: "mean", label: "Media de cada jugador", color: BASE_COLOR, values: rounds.map((r) => r.mean.spearman) },
            ]}
          />
        </div>

        <div className="card ac-chart">
          <h2 className="card-title">Sesgo por jornada</h2>
          <p className="card-note">
            Lo proyectado menos lo real, de media por jugador. Por encima del cero, la web prometió más
            puntos de los que hubo.
          </p>
          <RoundBias rounds={numbers} values={rounds.map((r) => r.model.bias)} />
          <p className="card-note ac-read">
            Las jornadas 2 y 3 se publicaron con la duda al 50% y sin distinguir a quien nunca entra
            en la convocatoria. El sesgo que quedaba venía de los minutos: esta temporada las
            rotaciones son más largas y los minutos del año pasado sobraban, sobre todo en los
            jugadores caros. Las dos cosas se corrigieron en octubre (ver{" "}
            <Link href="/metodologia#proyeccion">metodología</Link>).
          </p>
        </div>

        {calibration.length ? (
          <div className="card ac-chart">
            <h2 className="card-title">Probabilidad de jugar</h2>
            <p className="card-note">
              Lo que dijo la web de media frente a cuántos jugaron, por estado del parte de lesiones.
              Jornadas {first} a {last} juntas.
            </p>
            <PlayCalibration rows={calibration} />
            {regulars ? (
              <p className="card-note ac-read">
                Sin parte de lesiones jugó el {percent(regulars.real)}; la web decía el{" "}
                {percent(regulars.predicted)}. Un fijo que lo ha jugado todo ya no sale al 100%: el
                tope es del 95%, porque las bajas de última hora y los descansos existen.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {lineups.length ? (
        <div className="card ac-chart" style={{ marginTop: 44 }}>
          <h2 className="card-title">El once óptimo, jornada a jornada</h2>
          <p className="card-note">
            El once que salía de lo publicado (mismo presupuesto y reglas), puntuado con lo que pasó:
            quinteto y sexto al 100%, banquillo a la mitad, capitán doble y entrenador. La raya es el
            mejor once posible sabiendo ya los resultados.
          </p>
          <LineupRounds rows={lineups} />
        </div>
      ) : null}

      <details className="ac-data card" style={{ marginTop: 44 }}>
        <summary>Ver los datos en tabla</summary>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Acierto por jornada">
          <table className="data">
            <thead>
              <tr>
                <th>Jornada</th>
                <th className="num">N</th>
                <th className="num">Error HoopIQ</th>
                <th className="num">Error media</th>
                <th className="num">Spearman HoopIQ</th>
                <th className="num">Spearman media</th>
                <th className="num">Sesgo</th>
                <th className="num">Once proyectado</th>
                <th className="num">Once real</th>
                <th className="num">Mejor posible</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.round}>
                  <td>J{r.round}</td>
                  <td className="num">{num(r.n, 0)}</td>
                  <td className="num">
                    <strong>{num(r.model.mae, 2)}</strong>
                  </td>
                  <td className="num">{num(r.mean.mae, 2)}</td>
                  <td className="num">
                    <strong>{num(r.model.spearman, 2)}</strong>
                  </td>
                  <td className="num">{num(r.mean.spearman, 2)}</td>
                  <td className="num">{signed(r.model.bias, 2)}</td>
                  <td className="num">{num(r.lineup?.projected ?? null)}</td>
                  <td className="num">{num(r.lineup?.real ?? null)}</td>
                  <td className="num">{num(r.lineup?.best ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {calibration.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Probabilidad de jugar por estado del parte">
            <table className="data">
              <thead>
                <tr>
                  <th>Estado del parte</th>
                  <th className="num">Casos</th>
                  <th className="num">Dijo la web</th>
                  <th className="num">Jugaron</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td className="num">{num(row.n, 0)}</td>
                    <td className="num">{percent(row.predicted)}</td>
                    <td className="num">{percent(row.real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>

      <p className="card-note" style={{ marginTop: 20, maxWidth: "76ch" }}>
        Cómo se calcula cada pieza, en <Link href="/metodologia#proyeccion">metodología</Link>. Evaluación
        del {dateTime(backtest?.generatedAt)}; se repite en cada captura de datos.
      </p>
    </section>
  );
}
