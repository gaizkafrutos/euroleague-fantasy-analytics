import { ImageResponse } from "next/og";

/** Icono para cuando se añade la web a la pantalla de inicio del móvil.
 *  Se genera en el build: no hay ningún PNG que mantener a mano. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 13,
          paddingBottom: 46,
          background: "linear-gradient(140deg, #ff8a3d 0%, #ff5a4e 48%, #8b46f0 100%)",
        }}
      >
        <div style={{ width: 26, height: 46, borderRadius: 9, background: "rgba(255,255,255,0.65)" }} />
        <div style={{ width: 26, height: 74, borderRadius: 9, background: "rgba(255,255,255,0.84)" }} />
        <div style={{ width: 26, height: 102, borderRadius: 9, background: "#fff" }} />
      </div>
    ),
    size,
  );
}
