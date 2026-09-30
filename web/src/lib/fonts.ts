/** Tipografías del proyecto.
 *
 *  `next/font` las descarga y auto-hospeda en tiempo de compilación: el
 *  navegador del visitante no pide nada a Google y no hay salto de texto.
 *
 *  Archivo para titulares y cifras. Es variable en DOS ejes, y ahí está la
 *  gracia: `wght` como siempre, y `wdth` de 62 a 125. Una sola familia cubre
 *  los dos registros que pide la dirección — expandida para el nombre de un
 *  jugador a pantalla completa, condensada para una cifra tabular en una
 *  columna estrecha — sin cargar dos fuentes.
 *
 *  Schibsted Grotesk para el texto corrido. Sustituye a Inter: nació para un
 *  grupo de prensa, así que aguanta bien los tamaños pequeños de una web de
 *  datos, es tan compacta como Inter (las tablas no se ensanchan) y tiene más
 *  carácter. Sus cifras tabulares son de verdad: comprobado que "1111" y
 *  "0000" miden lo mismo con `tnum`. Libre Franklin quedó fuera justo por eso.
 */
import { Archivo, Schibsted_Grotesk } from "next/font/google";

export const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-display",
});

export const body = Schibsted_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});
