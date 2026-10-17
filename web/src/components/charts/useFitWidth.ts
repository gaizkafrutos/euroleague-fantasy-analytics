"use client";

/** Ancho real del contenedor de un gráfico, en px.
 *
 *  Los gráficos se dibujaban en un viewBox fijo (720–900) y el navegador los
 *  encogía: en un móvil de 375 px el texto de 14 unidades se veía a 6–7 px y
 *  los puntos de la nube a 2 px. Con el viewBox al ancho medido, una unidad es
 *  un píxel y el texto sale al tamaño que dice la hoja de estilos.
 *
 *  Antes de hidratar (y si no hay ResizeObserver) devuelve null: el gráfico se
 *  pinta con su ancho de diseño y se reajusta en cuanto se mide. */
import { useEffect, useRef, useState } from "react";

export function useFitWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
