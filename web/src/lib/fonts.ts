/** Tipografías del proyecto.
 *
 *  `next/font` las descarga y auto-hospeda en tiempo de compilación: el
 *  navegador del visitante no pide nada a Google y no hay salto de texto.
 *
 *  Archivo para titulares y cifras. Es variable en DOS ejes, y ahí está la
 *  gracia: `wght` como siempre, y `wdth` de 62 a 125. Una sola familia cubre
 *  los dos registros que pide la dirección — expandida para el nombre de un
 *  jugador a pantalla completa, condensada para una cifra tabular en una
 *  columna estrecha — sin cargar dos fuentes. Sustituye a Sora.
 *
 *  Inter para el texto corrido.
 */
import { Archivo, Inter } from "next/font/google";

export const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-display",
});

export const body = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});
