/** Dirección pública de la web, para metadatos, el mapa del sitio y robots.
 *
 *  Fija en el código: la variable de Vercel con la URL de producción elige
 *  ella misma entre los dominios del proyecto, y tras pasar a
 *  hoopiq-fantasy.vercel.app seguía dando el antiguo (que ahora solo
 *  redirige). La imagen que enseña LinkedIn al compartir sale de aquí, así
 *  que tiene que ser el dominio que sirve la web, no uno que redirige.
 *
 *  En los despliegues de Vercel (producción y previas) se usa el dominio de
 *  producción; en local, localhost. `NEXT_PUBLIC_SITE_URL` manda sobre todo
 *  lo demás, por si algún día hay dominio propio.
 */
const PRODUCTION_URL = "https://hoopiq-fantasy.vercel.app";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL ? PRODUCTION_URL : "http://localhost:3000");
