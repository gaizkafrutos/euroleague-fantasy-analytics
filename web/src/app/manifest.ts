import type { MetadataRoute } from "next";

import { BRAND_RASTER } from "@/lib/brand";

/** Para que "Añadir a pantalla de inicio" en el móvil deje algo que parezca una
 *  app y no un marcador del navegador. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HoopIQ — EuroLeague Fantasy Challenge",
    short_name: "HoopIQ",
    description:
      "Precios del EuroLeague Fantasy Challenge cruzados con las estadísticas oficiales de la EuroLiga.",
    lang: "es",
    start_url: "/",
    display: "standalone",
    background_color: BRAND_RASTER.bg,
    theme_color: BRAND_RASTER.bg,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
