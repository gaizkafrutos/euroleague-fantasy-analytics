"use client";

/** Foto de jugador con repuesto: si la imagen falla, iniciales en vez del icono
 *  de imagen rota (en la cancha de Mi equipo se veía un hueco feo).
 *
 *  `src` debe ser la miniatura (`player.thumb`, WebP de 96 px servido desde
 *  `public/fotos/`), no la foto original de la CDN: esa pesa ~700 KB y aquí se
 *  pinta a 30-36 px. No se usa `next/image` por el cupo de transformaciones del
 *  plan Hobby (ver `next.config.mjs` y `pipeline/efa/thumbs.py`). */
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
