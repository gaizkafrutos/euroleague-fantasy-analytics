/** El plan de cambios de la jornada: cuántos cambios, qué pasos y lo que gana
 *  cada uno. Solo pinta: el plan se calcula en la consola. */
import Explain from "@/components/ui/Explain";
import { credits, displayName, num, positionLabel, signed } from "@/lib/format";
import { MIN_GAIN_PER_TRADE, TRADES_PER_ROUND, tradeWindow, type TradePlan } from "@/lib/squad";

export default function TradePlanPanel({
  round,
  tradeWin,
  tradeLimit,
  onTradeLimit,
  overBudget,
  planning,
  plan,
  budget,
  onApply,
}: {
  round: number;
  tradeWin: ReturnType<typeof tradeWindow>;
  tradeLimit: number;
  onTradeLimit: (value: number) => void;
  /** La plantilla cuesta más de lo que hay: no se planifica hasta ajustarlo. */
  overBudget: boolean;
  planning: boolean;
  plan: TradePlan | null;
  budget: number;
  onApply: () => void;
}) {
  return (
    <section className="cancha-section" aria-labelledby="plan-cambios">
      <div className="cancha-section-head">
        <h2 id="plan-cambios">Plan de cambios para la J{round}</h2>
        <p>
          {tradeWin.unlimited
            ? "Ventana de cambios ilimitados: el plan lleva tu plantilla hasta lo mejor que cabe en tu presupuesto."
            : `Hasta ${TRADES_PER_ROUND} cambios por jornada, y el entrenador cuenta como uno. ${
                tradeWin.nextUnlimitedAfter
                  ? `La próxima ventana ilimitada se abre tras la J${tradeWin.nextUnlimitedAfter}.`
                  : ""
              }`}
        </p>
      </div>
      <div className="cancha-panel">
        {tradeWin.unlimited ? null : (
          <div className="segmented plan-limit" role="group" aria-label="Cambios que quieres hacer">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tradeLimit === value}
                onClick={() => onTradeLimit(value)}
              >
                {value} {value === 1 ? "cambio" : "cambios"}
              </button>
            ))}
          </div>
        )}
        {overBudget ? (
          <p className="muted" style={{ margin: 0 }}>
            Te pasas del presupuesto: ajústalo (o pon lo que tienes en caja) para planificar.
          </p>
        ) : planning && !plan ? (
          <p className="muted" style={{ margin: 0 }}>
            Calculando…
          </p>
        ) : plan && plan.steps.length ? (
          <>
            <ol className="plan-steps">
              {plan.steps.map((step, index) => (
                <li key={index}>
                  <div>
                    {step.trades.map((trade) => (
                      <div key={`${trade.out.id}-${trade.in.id}`} className="plan-trade">
                        <span className="muted">Sale</span> {displayName(trade.out)}{" "}
                        <span aria-hidden>→</span> <span className="muted">entra</span>{" "}
                        <b>{displayName(trade.in)}</b>
                        <i className="muted num">
                          {" "}
                          {trade.in.isCoach ? "entrenador" : positionLabel(trade.in.position)} ·{" "}
                          {credits(trade.in.price)} ({signed(trade.costDelta)} cr)
                        </i>
                      </div>
                    ))}
                    {step.trades.length > 1 ? (
                      <small className="muted">Van juntos: uno libera el dinero del otro.</small>
                    ) : null}
                  </div>
                  <span className="plan-gain num">
                    <b className="delta-up">{signed(step.gain)}</b>
                    <i className="muted">→ {num(step.scored)}</i>
                  </span>
                </li>
              ))}
            </ol>
            <div className="plan-summary">
              <span className="num">
                {num(plan.before)} → <b>{num(plan.after)}</b> pts ({signed(plan.after - plan.before)}) con{" "}
                {plan.used} {plan.used === 1 ? "cambio" : "cambios"} · te quedan{" "}
                {credits(budget - plan.spent)}
              </span>
              <button type="button" className="chip" onClick={onApply}>
                Aplicar el plan
              </button>
            </div>
            <Explain summary="Cómo se calcula el plan">
              Ordenados por lo que ganan y en un orden que siempre cabe en la caja. Cada cifra
              recoloca capitán, quinteto y banquillo tras el cambio. Búsqueda local contrastada
              con el óptimo exacto: igual en 26 de 30 plantillas de prueba, 0,1 puntos por
              debajo de media.
            </Explain>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Con {tradeWin.unlimited ? "cambios ilimitados" : `${tradeLimit} ${tradeLimit === 1 ? "cambio" : "cambios"}`}{" "}
            ningún cambio gana al menos {num(MIN_GAIN_PER_TRADE)} puntos dentro del presupuesto:
            no merece la pena gastarlos.
          </p>
        )}
      </div>
    </section>
  );
}
