import { ImageResponse } from "next/og";

import { meta, pricedPlayers, rosterPlayers } from "@/lib/data";

/** La tarjeta que sale cuando se pega el enlace en LinkedIn o en WhatsApp.
 *
 *  Sin esto, el enlace aparece como un rectángulo gris con una URL. Se genera
 *  en el build con los números reales del último snapshot, así que la tarjeta
 *  envejece con el proyecto en vez de quedarse anclada a un PNG de hace meses.
 */
export const alt = "Euroanalysis — análisis del EuroLeague Fantasy Challenge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          background: "#0a0c11",
          color: "#f2f4f8",
          fontFamily: "sans-serif",
        }}
      >
        {/* Halo, el mismo gesto que tiene la web detrás de la cabecera */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: -120,
            width: 900,
            height: 620,
            background: "radial-gradient(closest-side, rgba(255,106,43,0.30), rgba(255,106,43,0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -300,
            right: -160,
            width: 900,
            height: 660,
            background: "radial-gradient(closest-side, rgba(139,70,240,0.30), rgba(139,70,240,0))",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 66,
              height: 66,
              borderRadius: 18,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: 5,
              paddingBottom: 17,
              background: "linear-gradient(140deg, #ff8a3d 0%, #ff5a4e 48%, #8b46f0 100%)",
            }}
          >
            <div style={{ width: 10, height: 17, borderRadius: 3, background: "rgba(255,255,255,0.65)" }} />
            <div style={{ width: 10, height: 27, borderRadius: 3, background: "rgba(255,255,255,0.84)" }} />
            <div style={{ width: 10, height: 37, borderRadius: 3, background: "#fff" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8 }}>Euroanalysis</div>
            <div style={{ fontSize: 17, letterSpacing: 4, color: "#9aa3b2" }}>FANTASY CHALLENGE</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.05 }}>
            Gana la jornada antes
          </div>
          <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -2.6, lineHeight: 1.05, marginTop: -30 }}>
            de que se juegue.
          </div>
          <div style={{ fontSize: 27, color: "#9aa3b2", maxWidth: 820, lineHeight: 1.4 }}>
            Precios del Fantasy cruzados con las estadísticas oficiales de la EuroLiga.
          </div>
        </div>

        <div style={{ display: "flex", gap: 56, alignItems: "flex-end" }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 16, letterSpacing: 3, color: "#697384" }}>
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
              color: "#697384",
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
