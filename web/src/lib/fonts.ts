/** Tipografías del proyecto.
 *
 *  `next/font` las descarga y auto-hospeda en tiempo de compilación: el
 *  navegador del visitante no pide nada a Google y no hay salto de texto.
 *
 *  Sora para titulares — geométrica, con carácter pero sin gritar. Se usa en
 *  caja normal, no en mayúsculas: las mayúsculas grandes llaman la atención
 *  sobre sí mismas, y aquí lo que tiene que destacar son los datos.
 *
 *  Inter para todo lo demás, incluidas TODAS las cifras. En una tabla de
 *  números lo que importa es que aliñen, no que tengan personalidad.
 */
import { Inter, Sora } from "next/font/google";

export const display = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

export const body = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});
