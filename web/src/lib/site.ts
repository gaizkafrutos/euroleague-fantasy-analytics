/** Dirección pública de la web, para metadatos, el mapa del sitio y robots.
 *
 *  En Vercel sale de la URL de producción del proyecto; en local, localhost.
 *  `NEXT_PUBLIC_SITE_URL` la fija a mano si algún día hay dominio propio.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");
