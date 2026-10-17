import type { MetadataRoute } from "next";

import { meta, players, teams } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

/** Las secciones, los 20 clubes y cada ficha de jugador: sin esto un buscador
 *  solo encontraba las fichas siguiendo enlaces desde el mercado. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = meta.generatedAt ? new Date(meta.generatedAt) : new Date();
  const sections: Array<[string, number]> = [
    ["", 1],
    ["/mercado", 0.9],
    ["/mi-equipo", 0.8],
    ["/comparar", 0.6],
    ["/equipos", 0.7],
    ["/metodologia", 0.5],
    ["/acierta", 0.5],
  ];
  return [
    ...sections.map(([path, priority]) => ({ url: `${SITE_URL}${path}`, lastModified, priority })),
    ...teams.map((team) => ({ url: `${SITE_URL}/equipos/${team.code}`, lastModified, priority: 0.5 })),
    ...players.map((player) => ({ url: `${SITE_URL}/jugador/${player.id}`, lastModified, priority: 0.4 })),
  ];
}
