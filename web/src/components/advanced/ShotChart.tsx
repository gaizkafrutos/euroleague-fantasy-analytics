/** Mapa de tiro por zonas.
 *
 *  Media pista FIBA a escala (1 unidad = 1 cm, aro en el origen) con diez
 *  zonas. Cada zona se pinta según su acierto frente a la media de la liga en
 *  esa misma zona: frío si tira peor, gris si está en la media, cálido si
 *  mejor. Encima, los tiros de esta temporada: relleno anotado, hueco fallado.
 *
 *  Las zonas se recortan con máscaras sobre la geometría real de la pista
 *  (arco de 6,75 m, esquinas a 6,60 m, zona de 4,90 m), así que coinciden con
 *  lo que clasifica el pipeline, que usa las mismas medidas.
 *
 *  Debajo va la tabla con intentos y porcentajes: es la versión accesible y la
 *  que dice cuántos tiros hay detrás de cada color.
 */
import { num, percent, signed } from "@/lib/format";
import { divergingClass, seasonsLabel } from "@/lib/advanced";
import type { ShotDetail, ZoneCounts } from "@/lib/types";

/* ---------------------------------------------------------------- geometría */
const W = 1500;
const H = 1060;
const OX = 750; // x del aro
const OY = 157.5; // y del aro (la línea de fondo es y = 0)
const R3 = 675;
const CORNER_X = 660;
const CORNER_Y = Math.sqrt(R3 ** 2 - CORNER_X ** 2); // 141,5 cm por delante del aro
const CORNER_ZONE_Y = 150; // igual que el pipeline
const RIM = 125;
const PAINT_HALF = 245;
const PAINT_DEPTH = 423;
const FRONT = (22 * Math.PI) / 180;
const FAR = 3000;

const px = (x: number) => OX + x;
const py = (y: number) => OY + y;

const INSIDE_3 = `M ${px(-CORNER_X)} 0 L ${px(-CORNER_X)} ${py(CORNER_Y)} A ${R3} ${R3} 0 0 0 ${px(CORNER_X)} ${py(CORNER_Y)} L ${px(CORNER_X)} 0 Z`;
const PAINT = { x: px(-PAINT_HALF), y: 0, w: PAINT_HALF * 2, h: py(PAINT_DEPTH) };

const sx = Math.sin(FRONT) * FAR;
const sy = Math.cos(FRONT) * FAR;
const WEDGE_CENTER = `${OX},${OY} ${OX - sx},${OY + sy} ${OX + sx},${OY + sy}`;
const WEDGE_LEFT = `${OX},${OY} ${OX - sx},${OY + sy} ${-FAR},${FAR} ${-FAR},${-FAR} ${OX},${-FAR}`;
const WEDGE_RIGHT = `${OX},${OY} ${OX + sx},${OY + sy} ${FAR},${FAR} ${FAR},${-FAR} ${OX},${-FAR}`;

/** Dónde va la cifra de cada zona. */
const LABEL_AT: Record<string, [number, number]> = {
  rim: [0, 20],
  paint: [0, 300],
  mid_l: [-430, 170],
  mid_c: [0, 540],
  mid_r: [430, 170],
  c3_l: [-744, -95],
  ab3_l: [-610, 590],
  ab3_c: [0, 800],
  ab3_r: [610, 590],
  c3_r: [744, -95],
};

const MIN_ATTEMPTS = 8;

interface Props {
  /** Prefijo único para los ids de máscaras y recortes del SVG. */
  uid: string;
  shots: ShotDetail;
  league: ZoneCounts;
  keys: string[];
  labels: string[];
}

export default function ShotChart({ uid, shots, league, keys, labels }: Props) {
  const id = `shots-${uid}`;
  const rows = keys.map((key, index) => {
    const [att, made] = shots.zones[index] ?? [0, 0];
    const [latt, lmade] = league[index] ?? [0, 0];
    const pct = att ? made / att : null;
    const lpct = latt ? lmade / latt : null;
    const diff = pct !== null && lpct !== null ? pct - lpct : null;
    const enough = att >= MIN_ATTEMPTS;
    return {
      key,
      label: labels[index] ?? key,
      att,
      made,
      pct,
      lpct,
      diff,
      enough,
      cls: enough ? divergingClass(diff === null ? null : diff * 100, 3) : null,
    };
  });
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  const fill = (key: string) => {
    const row = byKey[key];
    return row?.cls === null || row?.cls === undefined ? "zone-few" : `zone-div-${row.cls}`;
  };

  const zoneShape = (key: string) => {
    // Con pocos tiros la zona no se colorea: se raya, para que no se confunda
    // con el gris de "en la media".
    const few = byKey[key]?.cls === null || byKey[key]?.cls === undefined;
    const common = {
      className: `shot-zone ${fill(key)}`,
      ...(few ? { style: { fill: `url(#${id}-hatch)` } } : {}),
    };
    switch (key) {
      case "rim":
        return <circle {...common} cx={OX} cy={OY} r={RIM} clipPath={`url(#${id}-court)`} />;
      case "paint":
        return (
          <path
            {...common}
            fillRule="evenodd"
            d={`M ${PAINT.x} ${PAINT.y} h ${PAINT.w} v ${PAINT.h} h ${-PAINT.w} Z M ${OX - RIM} ${OY} a ${RIM} ${RIM} 0 1 0 ${RIM * 2} 0 a ${RIM} ${RIM} 0 1 0 ${-RIM * 2} 0 Z`}
          />
        );
      case "mid_l":
      case "mid_c":
      case "mid_r":
        return (
          <polygon
            {...common}
            points={key === "mid_l" ? WEDGE_LEFT : key === "mid_c" ? WEDGE_CENTER : WEDGE_RIGHT}
            clipPath={`url(#${id}-in3)`}
            mask={`url(#${id}-nopaint)`}
          />
        );
      case "c3_l":
      case "c3_r":
        return (
          <rect
            {...common}
            x={key === "c3_l" ? 0 : OX}
            y={0}
            width={OX}
            height={py(CORNER_ZONE_Y)}
            mask={`url(#${id}-out3)`}
          />
        );
      default:
        return (
          <polygon
            {...common}
            points={key === "ab3_l" ? WEDGE_LEFT : key === "ab3_c" ? WEDGE_CENTER : WEDGE_RIGHT}
            clipPath={`url(#${id}-deep)`}
            mask={`url(#${id}-out3)`}
          />
        );
    }
  };

  const summary = rows
    .filter((row) => row.att)
    .map((row) => `${row.label}: ${row.made}/${row.att}`)
    .join("; ");

  return (
    <div className="shots">
      <div className="shots-court">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mapa de tiro. ${summary}`}>
          <defs>
            <pattern id={`${id}-hatch`} width={36} height={36} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={36} height={36} className="hatch-bg" />
              <line x1={0} y1={0} x2={0} y2={36} className="hatch-line" />
            </pattern>
            <clipPath id={`${id}-court`}>
              <rect x={0} y={0} width={W} height={H} />
            </clipPath>
            <clipPath id={`${id}-in3`}>
              <path d={INSIDE_3} />
            </clipPath>
            <clipPath id={`${id}-deep`}>
              <rect x={0} y={py(CORNER_ZONE_Y)} width={W} height={H} />
            </clipPath>
            <mask id={`${id}-nopaint`}>
              <rect x={0} y={0} width={W} height={H} fill="white" />
              <rect x={PAINT.x} y={PAINT.y} width={PAINT.w} height={PAINT.h} fill="black" />
            </mask>
            <mask id={`${id}-out3`}>
              <rect x={0} y={0} width={W} height={H} fill="white" />
              <path d={INSIDE_3} fill="black" />
            </mask>
          </defs>

          <g clipPath={`url(#${id}-court)`}>
            {keys.map((key) => (
              <g key={key}>
                {zoneShape(key)}
                <title>
                  {`${byKey[key]?.label}: ${byKey[key]?.made}/${byKey[key]?.att}` +
                    (byKey[key]?.pct != null ? ` (${percent(byKey[key]?.pct)}; liga ${percent(byKey[key]?.lpct)})` : "")}
                </title>
              </g>
            ))}
          </g>

          {/* Líneas de pista, por encima de las zonas */}
          <g className="court-ink" fill="none">
            <rect x={0} y={0} width={W} height={H} />
            <rect x={PAINT.x} y={PAINT.y} width={PAINT.w} height={PAINT.h} />
            <path d={`M ${OX - 180} ${py(PAINT_DEPTH)} a 180 180 0 0 0 360 0`} />
            <path d={INSIDE_3} />
            <path d={`M ${OX - RIM} ${OY} a ${RIM} ${RIM} 0 0 0 ${RIM * 2} 0`} />
            <line x1={OX - 90} x2={OX + 90} y1={OY - 37.5} y2={OY - 37.5} className="court-board" />
            <circle cx={OX} cy={OY} r={22.5} />
          </g>

          {/* Tiros de esta temporada */}
          <g className="shot-dots">
            {shots.dots.map(([x, y, made], index) => (
              <circle
                key={index}
                cx={px(x)}
                cy={py(y)}
                r={15}
                className={made ? "is-made" : "is-missed"}
              />
            ))}
          </g>

          {rows.map((row) => {
            const [lx, ly] = LABEL_AT[row.key] ?? [0, 0];
            if (!row.att) return null;
            return (
              <text
                key={`t-${row.key}`}
                x={px(lx)}
                y={py(ly)}
                className={`zone-label${row.key.startsWith("c3") ? " is-corner" : ""}${row.enough ? "" : " is-few"}`}
                textAnchor={row.key === "c3_l" ? "start" : row.key === "c3_r" ? "end" : "middle"}
                dominantBaseline="middle"
              >
                {row.pct === null ? "" : percent(row.pct)}
              </text>
            );
          })}
        </svg>

        <div className="shots-legend">
          <span className="shots-ramp" aria-hidden>
            <i className="zone-div--2" />
            <i className="zone-div--1" />
            <i className="zone-div-0" />
            <i className="zone-div-1" />
            <i className="zone-div-2" />
          </span>
          <span>peor ← acierto frente a la liga en esa zona → mejor</span>
          <span className="shots-key">
            <i className="shots-chip zone-few" aria-hidden /> menos de {MIN_ATTEMPTS} tiros
          </span>
          {shots.dots.length ? (
            <span className="shots-key">
              <i className="is-made" /> anotado <i className="is-missed" /> fallado · esta temporada
            </span>
          ) : null}
        </div>
      </div>

      <div className="shots-side">
        <dl className="shots-profile">
          <div>
            <dt>Puntos por tiro</dt>
            <dd className="num">{num(shots.profile.pointsPerShot, 2)}</dd>
          </div>
          <div>
            <dt>Tiros de tres</dt>
            <dd className="num">{percent(shots.profile.threeRate)}</dd>
          </div>
          <div>
            <dt>En el aro</dt>
            <dd className="num">{percent(shots.profile.rimRate)}</dd>
          </div>
          <div>
            <dt>Al contraataque</dt>
            <dd className="num">{percent(shots.profile.fastbreak)}</dd>
          </div>
        </dl>

        <table className="shots-table">
          <caption className="sr-only">Acierto por zona frente a la media de la liga</caption>
          <thead>
            <tr>
              <th scope="col">Zona</th>
              <th scope="col" className="num">Tiros</th>
              <th scope="col" className="num">Acierto</th>
              <th scope="col" className="num">Liga</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.att)
              .sort((a, b) => b.att - a.att)
              .map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <i className={`shots-chip ${row.cls === null ? "zone-few" : `zone-div-${row.cls}`}`} aria-hidden />
                    {row.label}
                  </th>
                  <td className="num">
                    {row.made}/{row.att}
                  </td>
                  <td className="num">{percent(row.pct)}</td>
                  <td className="num muted">
                    {percent(row.lpct)}
                    {row.enough && row.diff !== null ? (
                      <small className={row.diff >= 0 ? "delta-up" : "delta-down"}>
                        {" "}
                        {signed(row.diff * 100, 0)}
                      </small>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="shots-source">
          {shots.profile.attempts} tiros de campo · {seasonsLabel(shots.seasons)}. Con menos de{" "}
          {MIN_ATTEMPTS} intentos la zona queda rayada: no hay muestra para colorearla.
        </p>
      </div>
    </div>
  );
}
