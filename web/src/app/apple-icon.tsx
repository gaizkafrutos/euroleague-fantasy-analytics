import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Icono para cuando se añade la web a la pantalla de inicio del móvil.
 *  Se genera en el build: no hay ningún PNG que mantener a mano. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** El símbolo del logotipo, leído del disco en el build y embebido. */
const markSrc = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public/brand/hoopiq-mark.png"),
).toString("base64")}`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07080c",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markSrc} width={136} height={136} alt="" />
      </div>
    ),
    size,
  );
}
