/** Piezas pequeñas que se repiten por toda la app. */
import Link from "next/link";

import { deltaClass, displayName, initials, num, positionLabel, prettyName } from "@/lib/format";
import type { Player } from "@/lib/types";

/* `prettyName` e `initials` viven en lib/format: los necesita código que no
   pinta nada. Se reexportan aquí porque media app los importa por este camino. */
export { initials, prettyName };

export function PositionBadge({ position }: { position: string | null }) {
  if (!position) return <span className="muted">—</span>;
  return (
    <span className={`badge pos-${position}`}>
      <i className="badge-dot" style={{ background: "var(--pos-color)" }} />
      {positionLabel(position)}
    </span>
  );
}

export function Delta({
  value,
  digits = 1,
  suffix = "",
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
}) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const arrow = Math.abs(value) < 0.001 ? "" : value > 0 ? "▲" : "▼";
  return (
    <span className={deltaClass(value)}>
      {arrow ? <span aria-hidden>{arrow}</span> : null}
      {num(Math.abs(value), digits)}
      {suffix}
    </span>
  );
}

const AVAILABILITY_WORD: Record<string, string> = {
  out: "Baja",
  doubt: "Duda",
  probable: "Probable",
};

/** Aviso de disponibilidad: punto + una palabra, y la frase entera en el
 *  `title` y para lectores de pantalla. Una palabra cabe en una ficha de móvil;
 *  "Baja hasta la J4 · Medial right meniscus tear" no. Con `full` se enseña la
 *  frase (en la cancha y en el buscador hay sitio). */
export function AvailabilityTag({
  player,
  full = false,
}: {
  player: Pick<Player, "availability">;
  full?: boolean;
}) {
  const status = player.availability;
  if (!status) return null;
  const word = AVAILABILITY_WORD[status.level] ?? status.level;
  const description = [status.label, status.detail].filter(Boolean).join(" · ");
  return (
    <span className={`avail avail-${status.level}`} title={description}>
      <i aria-hidden />
      <span aria-hidden={full ? undefined : true}>{full ? status.label : word}</span>
      {full ? null : <span className="sr-only">{description}</span>}
    </span>
  );
}

/** Avatar + nombre + club.
 *
 *  `linked` existe porque en la lista de fichas del móvil la tarjeta ENTERA ya
 *  es un enlace, y un `<a>` dentro de otro `<a>` es HTML inválido: el navegador
 *  reescribe el árbol y React se encuentra algo distinto a lo que sirvió el
 *  servidor. Eso rompía la hidratación de la portada en móvil.
 */
export function PlayerCell({ player, linked = true }: { player: Player; linked?: boolean }) {
  const inner = (
    <>
      {player.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={player.image} alt="" loading="lazy" />
      ) : (
        <span className="avatar avatar-initials" aria-hidden>
          {initials(player.name ?? player.marketName)}
        </span>
      )}
      <span>
        <span className="player-name">{displayName(player)}</span>
        <br />
        <span className="player-meta">
          {player.clubShort ?? player.club ?? "—"} · {positionLabel(player.position)}
          {player.availability ? (
            <>
              {" "}
              <AvailabilityTag player={player} />
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  if (!linked) return <span className="player-cell">{inner}</span>;

  return (
    <Link href={`/jugador/${player.id}`} className="player-cell">
      {inner}
    </Link>
  );
}

/** Número con una barra proporcional detrás.
 *
 *  Veinte filas de cifras se leen una a una; con la barra, la columna entera se
 *  lee de un vistazo. Solo la llevan las columnas que de verdad se comparan: si
 *  la llevaran todas, la tabla sería un gráfico de barras ilegible. */
export function BarCell({
  value,
  fraction,
  digits = 1,
  strong = false,
}: {
  value: number | null | undefined;
  fraction: number | null;
  digits?: number;
  strong?: boolean;
}) {
  const width = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <span className="bar-cell">
      <span
        className="bar-cell-fill"
        style={{ width: `${width * 100}%` }}
        aria-hidden
      />
      <span className="bar-cell-value">
        {strong ? <strong>{num(value, digits)}</strong> : num(value, digits)}
      </span>
    </span>
  );
}

/** Dónde cae un jugador dentro de los de su posición. */
export function PercentileBar({
  label,
  percentile,
  detail,
}: {
  label: string;
  percentile: number;
  detail?: string;
}) {
  const top = Math.max(1, Math.round((1 - percentile) * 100));
  const strong = percentile >= 0.75;
  const weak = percentile <= 0.25;
  // "Top 49%" en la mediana es ruido con pinta de elogio. En la franja central
  // se dice lo que es: está en la media.
  const caption =
    percentile >= 0.56
      ? `Top ${top}%`
      : percentile <= 0.44
        ? `Percentil ${Math.round(percentile * 100)}`
        : "En la media";
  return (
    <div className="pctl">
      <div className="pctl-head">
        <span className="pctl-label">{label}</span>
        <span className={`pctl-value${strong ? " is-strong" : weak ? " is-weak" : ""}`}>
          {caption}
        </span>
      </div>
      <div
        className="pctl-track"
        role="img"
        aria-label={`${label}: percentil ${Math.round(percentile * 100)} de su posición`}
      >
        <span
          className={`pctl-fill${strong ? " is-strong" : weak ? " is-weak" : ""}`}
          style={{ width: `${Math.max(2, percentile * 100)}%` }}
        />
      </div>
      {detail ? <div className="pctl-detail num">{detail}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value num">{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "warning",
}: {
  children: React.ReactNode;
  tone?: "warning" | "serious";
}) {
  return (
    <div className={`notice${tone === "serious" ? " notice-serious" : ""}`}>
      <svg className="notice-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 4.5v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
      </svg>
      <div>{children}</div>
    </div>
  );
}
