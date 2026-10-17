/** Página no encontrada.
 *
 *  Antes salía la de Next por defecto: negra, en inglés y fuera del sistema
 *  visual. Casi siempre se llega aquí por un jugador que ya no está en el
 *  mercado o por un enlace viejo, así que se dice eso y se ofrece por dónde
 *  seguir.
 */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Página no encontrada",
};

export default function NotFound() {
  return (
    <section className="section shell not-found">
      <header className="cancha-head">
        <h1>Esta página no existe.</h1>
        <p className="lede">
          Puede que el enlace sea antiguo o que el jugador ya no esté en el mercado de esta
          temporada. Búscalo arriba por su nombre o sigue por aquí.
        </p>
      </header>
      <div className="not-found-actions">
        <Link className="button-primary" href="/mercado">
          Ir al mercado
        </Link>
        <Link className="button-ghost" href="/equipos">
          Ver los equipos
        </Link>
        <Link className="text-button" href="/">
          Portada
        </Link>
      </div>
    </section>
  );
}
