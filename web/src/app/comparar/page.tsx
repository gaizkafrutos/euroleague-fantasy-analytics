/** Comparador: de dos a cuatro jugadores, cara a cara.
 *
 *  La pregunta que más se hace en un fantasy no es "¿es bueno?", es "¿este o
 *  aquel?". La ficha contesta la primera; esto, la segunda. La selección vive
 *  en la URL (`?ids=1,2,3`) para poder compartir la comparación.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import Comparator from "@/components/compare/Comparator";
import { compareIndex } from "@/lib/compare";

export const metadata: Metadata = {
  title: "Comparar jugadores",
  description:
    "Dos, tres o cuatro jugadores del EuroLeague Fantasy Challenge cara a cara: proyección, probabilidad de jugar, minutos, precio, revalorización, calendario y techo.",
};

export default function ComparePage() {
  return (
    <section className="section shell">
      <header className="cancha-head">
        <h1>Comparar jugadores</h1>
        <p className="lede">
          Hasta cuatro, cara a cara. En cada fila se marca el mejor; el precio y el calendario no
          se marcan porque lo mejor depende de lo que busques.
        </p>
      </header>
      {/* useSearchParams necesita un límite de Suspense en una página estática. */}
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <Comparator index={compareIndex()} />
      </Suspense>
    </section>
  );
}
