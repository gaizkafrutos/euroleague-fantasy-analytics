/** Lo que menos renta de la plantilla y los fichajes que caben. Solo pinta:
 *  las dos listas las calcula la consola. */
import Explain from "@/components/ui/Explain";
import { AvailabilityTag, Delta, PlayerCell } from "@/components/ui/primitives";
import { credits, displayName, num, positionLabel, signed } from "@/lib/format";
import { rentInRole, roleMultiplier, type Roles, type Swap } from "@/lib/squad";
import type { Player } from "@/lib/types";

export default function SquadDiagnosis({
  weakest,
  swaps,
  roles,
  free,
}: {
  weakest: Player[];
  swaps: Swap[];
  roles: Roles;
  /** Créditos libres (puede ser negativo si la plantilla se pasa). */
  free: number;
}) {
  return (
    <div className="grid grid-2 cancha-diagnosis">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Lo que menos te renta</div>
            <p className="card-note" style={{ margin: "4px 0 0" }}>
              Puntos por crédito en el sitio que ocupa cada uno.
            </p>
            <Explain summary="Por qué este orden">
              El capitán cuenta doble y el banquillo la mitad. Un titular caro que proyecta
              poco sale aquí antes que un suplente barato.
            </Explain>
          </div>
        </div>
        {weakest.length ? (
          <ol className="rank-list">
            {weakest.map((player) => (
              <li key={player.id}>
                <PlayerCell player={player} />
                {/* Sin rojo: que sea el que menos renta de TU plantilla no
                    lo convierte en un mal jugador, y pintarlo de alarma
                    dice algo que el dato no dice. El orden ya ordena. */}
                <span className="rank-value">
                  {num(rentInRole(roles, player), 2)}
                  <span className="muted" style={{ fontSize: "0.75rem", fontWeight: 500 }}>
                    {" "}
                    pts/cr{" "}
                    {roleMultiplier(roles, player) === 0.5
                      ? "· banquillo"
                      : roleMultiplier(roles, player) === 2
                        ? "· capitán"
                        : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Sin precios para valorar el rendimiento.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Fichajes que caben</div>
            <p className="card-note" style={{ margin: "4px 0 0" }}>
              El mejor recambio por puesto que cabe en tu caja.
            </p>
            <Explain summary="Cómo se calcula">
              Entrenador incluido, dentro de tus {credits(Math.max(free, 0))} libres más
              lo que recuperas al vender. La ganancia es la real: si el fichaje acaba en el
              banquillo, suma la mitad. Nunca propone a nadie de baja o sin inscribir.
            </Explain>
          </div>
        </div>
        {swaps.length ? (
          <ul className="swap-list">
            {swaps.map((swap) => (
              <li key={`${swap.out.id}-${swap.in.id}`}>
                <div className="swap-move">
                  <span className="swap-out">
                    <span className="muted">Sale</span> {displayName(swap.out)}
                    {swap.out.availability?.level === "out" ? (
                      <AvailabilityTag player={swap.out} />
                    ) : null}
                  </span>
                  <span className="swap-arrow" aria-hidden>
                    →
                  </span>
                  <span className="swap-in">
                    <span className="muted">Entra</span> {displayName(swap.in)}
                    <i className="muted num">
                      {swap.in.clubShort} · {positionLabel(swap.in.position)} ·{" "}
                      {credits(swap.in.price)}
                    </i>
                    {swap.risky ? <AvailabilityTag player={swap.in} full /> : null}
                  </span>
                </div>
                {/* La ganancia es la razón por la que se lee esta tarjeta:
                    va en grande, y el coste debajo en pequeño. */}
                <div className="swap-gain">
                  <b className="delta-up num">{signed(swap.gain)}</b>
                  <i className="muted">pts</i>
                  <span className="num">
                    <Delta value={swap.costDelta} digits={1} suffix=" cr" />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No hay mejora posible dentro del presupuesto con los datos actuales.
          </p>
        )}
      </div>
    </div>
  );
}
