import { displayName, num } from "@/lib/format";
import { checkSquad, effectiveProjection } from "@/lib/squad";
import type { Player } from "@/lib/types";

/** De dónde sale la proyección real: una barra de parte-todo, cinco tramos.
 *  La rampa es ordinal (del capitán, que más aporta por jugador, al banquillo)
 *  y va en un solo tono; el entrenador, que es otra cosa, va en neutro. */
export default function Contribution({
  roles,
  scored,
  coach,
}: {
  roles: ReturnType<typeof checkSquad>["roles"];
  scored: number;
  coach: Player | null;
}) {
  const p = effectiveProjection;
  const captainPts = p(roles.captain) * 2;
  const restPts = roles.starters
    .filter((player) => player.id !== roles.captain?.id)
    .reduce((sum, player) => sum + p(player), 0);
  const sixthPts = p(roles.sixth);
  const benchRaw = roles.bench.reduce((sum, player) => sum + p(player), 0);
  const benchPts = benchRaw / 2;
  const coachPts = p(coach);
  const benchCredits = roles.bench.reduce((sum, player) => sum + (player.price ?? 0), 0);

  const segments = [
    {
      key: "s1",
      label: "Capitán ×2",
      value: captainPts,
      note: roles.captain ? displayName(roles.captain) : "",
    },
    {
      key: "s2",
      label: "Resto del quinteto",
      value: restPts,
      note: `${Math.max(roles.starters.length - 1, 0)} jugadores`,
    },
    {
      key: "s3",
      label: "Sexto hombre",
      value: sixthPts,
      note: roles.sixth ? displayName(roles.sixth) : "",
    },
    { key: "s4", label: "Banquillo ×0,5", value: benchPts, note: `de ${num(benchRaw)} brutos` },
    { key: "s5", label: "Entrenador", value: coachPts, note: coach ? displayName(coach) : "" },
  ];
  // Una barra apilada no sabe pintar negativos: un entrenador que proyecta
  // restar sale de la barra y se dice en la leyenda.
  const drawn = segments.filter((segment) => segment.value > 0);
  const summary = segments.map((segment) => `${segment.label} ${num(segment.value)}`).join("; ");

  return (
    <section className="cancha-section">
      <div className="cancha-section-head">
        <h2>De dónde salen los {num(scored)}</h2>
        <p>Proporciones reales sobre el total proyectado.</p>
      </div>
      <div className="cancha-panel">
        <div className="cancha-stack" role="img" aria-label={summary}>
          {drawn.map((segment) => (
            <span key={segment.key} className={segment.key} style={{ flex: segment.value }} />
          ))}
        </div>
        <div className="cancha-legend">
          {segments.map((segment) => (
            <div key={segment.key}>
              <i className={segment.key} aria-hidden />
              {segment.label} <b className="num">{num(segment.value)}</b>
              {segment.note ? <small>{segment.note}</small> : null}
            </div>
          ))}
        </div>
        <p className="cancha-callout">
          El banquillo se lleva <strong>{num(benchCredits)} créditos</strong> y devuelve{" "}
          <strong>{num(benchPts)} puntos</strong>, porque puntúa a la mitad.
          {benchCredits > 0 ? (
            <>
              {" "}
              Cada crédito ahí rinde {num(benchPts / benchCredits, 2)}; en los seis que puntúan
              enteros,{" "}
              {num(
                (captainPts + restPts + sixthPts) /
                  Math.max(
                    [...roles.starters, roles.sixth].reduce(
                      (sum, player) => sum + (player?.price ?? 0),
                      0,
                    ),
                    1,
                  ),
                2,
              )}
              .
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
