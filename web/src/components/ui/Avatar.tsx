"use client";

/** Foto de jugador con repuesto: si la CDN falla, iniciales en vez del icono de
 *  imagen rota (en la cancha de Mi equipo se veía un hueco feo). */
import { useState } from "react";

import { initials } from "@/lib/format";

export default function Avatar({
  src,
  name,
  className = "avatar",
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={`${className} avatar-initials`} aria-hidden>
        {initials(name)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}
