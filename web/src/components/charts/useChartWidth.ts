"use client";

/** Ancho real del contenedor, para dibujar el SVG a escala 1:1.
 *
 *  Los demás gráficos usan un viewBox fijo de 720 y en el móvil el texto se
 *  encoge hasta los 7 px. Con el ancho medido, las cifras de los ejes se leen
 *  igual en un teléfono que en el escritorio. En el servidor (y antes de medir)
 *  vale `fallback`.
 */
import { useEffect, useRef, useState } from "react";

export function useChartWidth<T extends HTMLElement>(fallback = 560) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.max(240, Math.round(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
