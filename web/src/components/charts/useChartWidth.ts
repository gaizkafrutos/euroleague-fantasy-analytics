"use client";

/** Ancho real del contenedor, para dibujar el SVG a escala 1:1, con un valor
 *  por defecto para el servidor y antes de medir.
 *
 *  Es la misma medida que `useFitWidth` (que usan los gráficos de la ficha y
 *  del mercado); esta variante solo añade el ancho de reserva y un mínimo de
 *  240 px para los gráficos de la página de acierto.
 */
import { useFitWidth } from "./useFitWidth";

export function useChartWidth<T extends HTMLElement>(fallback = 560) {
  const [ref, measured] = useFitWidth<T>();
  return [ref, Math.max(240, measured ?? fallback)] as const;
}
