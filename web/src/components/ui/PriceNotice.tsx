/** Aviso de precios desfasados: el juego aún no ha aplicado la revalorización
 *  de la última jornada en la captura que tenemos. La web enseña entonces el
 *  precio pendiente (lo que costará cada uno al cerrarla) y lo dice. */
import { meta } from "@/lib/data";
import { dateTime } from "@/lib/format";

export default function PriceNotice() {
  const fresh = meta.priceFreshness;
  if (!fresh?.stale || !fresh.capturedAt) return null;
  return (
    <div className="price-notice" role="status">
      <div className="shell">
        <strong>Precios en revisión.</strong> La última captura es del {dateTime(fresh.capturedAt)}
        {fresh.round ? ` y la J${fresh.round} ` : " y la jornada "}
        {fresh.reason === "captura con la jornada a medias"
          ? "no había terminado."
          : "estaba cerrada, pero el juego aún no había revalorizado."}{" "}
        Enseñamos el precio que tendrá cada jugador al cerrarla
        {fresh.pending ? ` (${fresh.pending} cambian)` : ""}; se confirma con la próxima captura.
      </div>
    </div>
  );
}
