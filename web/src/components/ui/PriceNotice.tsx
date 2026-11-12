/** Aviso de precios desfasados: el juego aún no ha aplicado la revalorización
 *  de la última jornada en la captura que tenemos. La web enseña entonces el
 *  precio pendiente (lo que costará cada uno al cerrarla) y lo dice. */
import { meta } from "@/lib/data";
import { dateTime } from "@/lib/format";

export default function PriceNotice() {
  const fresh = meta.priceFreshness;
  if (!fresh?.stale || !fresh.capturedAt) return null;
  const round = fresh.round ? `la J${fresh.round}` : "la jornada";
  // "Estaba cerrada" solo si se habían jugado todos sus partidos: con dos de
  // diez la web lo decía igual.
  const open =
    fresh.reason === "jornada en juego" || fresh.reason === "captura con la jornada a medias";
  const progress =
    typeof fresh.roundPlayed === "number" && typeof fresh.roundGames === "number" && fresh.roundPlayed < fresh.roundGames
      ? ` (${fresh.roundPlayed} de ${fresh.roundGames} partidos)`
      : "";
  // Una línea a la vista y el resto plegado: en el móvil el párrafo entero se
  // comía un tercio de la primera pantalla de todas las páginas.
  return (
    <details className="price-notice">
      <summary className="shell">
        <span role="status">
          <strong>Precios en revisión.</strong>{" "}
          {open ? `${round.replace(/^l/, "L")} está en juego${progress}.` : `${round.replace(/^l/, "L")} ya cerró y el juego aún no ha revalorizado.`}
        </span>
        <span className="price-notice-more">Detalles</span>
      </summary>
      <div className="shell price-notice-body">
        La última captura es del {dateTime(fresh.capturedAt)}
        {open
          ? ": el juego no mueve los precios hasta que termina la jornada."
          : ", con la jornada ya cerrada, pero el juego aún no había aplicado la revalorización."}{" "}
        Enseñamos el precio que tendrá cada jugador al cerrarla
        {fresh.pending ? ` (${fresh.pending} cambian)` : ""}; se confirma con la próxima captura.
      </div>
    </details>
  );
}
