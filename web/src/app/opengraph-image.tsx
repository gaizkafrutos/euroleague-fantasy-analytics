import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BRAND_RASTER as C } from "@/lib/brand";
import { meta, pricedPlayers, rosterPlayers } from "@/lib/data";

/** La tarjeta que sale cuando se pega el enlace en LinkedIn o en WhatsApp.
 *
 *  Sin esto, el enlace aparece como un rectángulo gris con una URL. Se genera
 *  en el build con los números reales del último snapshot, así que la tarjeta
 *  envejece con el proyecto en vez de quedarse anclada a un PNG de hace meses.
 */
export const alt = "HoopIQ — análisis del EuroLeague Fantasy Challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** El símbolo del logotipo, leído del disco en el build y embebido. */
const markSrc = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public/brand/mark-on-dark.png"),
).toString("base64")}`;

export default function OpengraphImage() {
  const universe = meta.hasPrices ? pricedPlayers : rosterPlayers;

  const facts: Array<[string, string]> = [
    ["Jugadores", String(universe.length)],
    ["Identificados", `${Math.round(meta.matchRate * 100)}%`],
    ["Jornada", `${meta.currentRound} / ${meta.totalRounds}`],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 76px",
          background: C.bg,
          color: C.ink,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markSrc} width={70} height={70} alt="" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -0.8 }}>
              Hoop<span style={{ color: C.brand }}>IQ</span>
            </div>
            <div style={{ fontSize: 17, letterSpacing: 4, color: C.ink2 }}>FANTASY CHALLENGE</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.05 }}>
            Gana la jornada antes
          </div>
          <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.05, marginTop: -30 }}>
            de que se juegue.
          </div>
          <div style={{ fontSize: 27, color: C.ink2, maxWidth: 820, lineHeight: 1.4 }}>
            Precios del Fantasy cruzados con las estadísticas oficiales de la EuroLiga.
          </div>
        </div>

        <div style={{ display: "flex", gap: 56, alignItems: "flex-end" }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 16, letterSpacing: 3, color: C.ink3 }}>
                {label.toUpperCase()}
              </div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1.2 }}>{value}</div>
            </div>
          ))}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              fontSize: 20,
              color: C.ink3,
            }}
          >
            {meta.seasonLabel}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
