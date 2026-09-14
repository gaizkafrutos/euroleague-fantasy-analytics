/** Tipografías del proyecto.
 *
 *  `next/font` descarga y auto-hospeda las fuentes en tiempo de compilación:
 *  el navegador no pide nada a Google, no hay petición externa en runtime y no
 *  hay salto de texto al cargar.
 *
 *  Archivo Black para titulares — pesada y ancha, en la línea de la gráfica
 *  oficial del Fantasy Challenge. El resto del texto y TODAS las cifras de los
 *  gráficos siguen en la sans del sistema: en una tabla de números lo que
 *  importa es que alineen, no que tengan personalidad.
 */
import { Archivo_Black, Inter } from "next/font/google";

export const display = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

export const body = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});
