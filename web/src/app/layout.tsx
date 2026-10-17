import type { Metadata, Viewport } from "next";

import Header from "@/components/ui/Header";
import MobileNav from "@/components/ui/MobileNav";
import { meta } from "@/lib/data";
import { checkedLater, dateTime } from "@/lib/format";
import { searchIndex } from "@/lib/search-index";
import PriceNotice from "@/components/ui/PriceNotice";
import { body, display } from "@/lib/fonts";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

/** La URL absoluta del sitio, necesaria para que la tarjeta de compartir
 *  apunte a una imagen real. Vercel inyecta el dominio de producción solo. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "HoopIQ — análisis del EuroLeague Fantasy Challenge",
    template: "%s · HoopIQ",
  },
  description:
    "Cruce de los precios del EuroLeague Fantasy Challenge con las estadísticas oficiales de la Euroliga: valor por crédito, tendencias de precio, consistencia y cambios de rol.",
  applicationName: "HoopIQ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "HoopIQ",
    statusBarStyle: "black-translucent",
  },
  // Lo que enseña LinkedIn al compartir el enlace: "HoopIQ" a secas no decía
  // de qué va la web.
  openGraph: {
    title: "HoopIQ — análisis del EuroLeague Fantasy Challenge",
    description:
      "Chollos, subidas de precio y cambios de rol en el EuroLeague Fantasy Challenge, con datos reales.",
    type: "website",
    locale: "es_ES",
    siteName: "HoopIQ",
  },
  twitter: {
    card: "summary_large_image",
    title: "HoopIQ — análisis del EuroLeague Fantasy Challenge",
    description:
      "Chollos, subidas de precio y cambios de rol en el EuroLeague Fantasy Challenge, con datos reales.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // El contenido llega hasta los bordes del móvil; los huecos del notch y de la
  // barra de gestos se compensan luego con env(safe-area-inset-*).
  viewportFit: "cover",
  // El fondo de la paleta (Parquet). No hay tema oscuro.
  themeColor: "#faf9f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `data-scroll-behavior`: el CSS pone `scroll-behavior: smooth` en <html>, y
  // este atributo le dice a Next que es intencionado, para que no lo desactive
  // en los cambios de ruta.
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        <Header round={meta.currentRound} totalRounds={meta.totalRounds} searchIndex={searchIndex} />
        <PriceNotice />
        <main id="contenido">{children}</main>
        <footer className="footer">
          <div className="shell">
            {/* Dos líneas y no un párrafo que se repetía entero, con fechas al
                segundo, al final de cada página. */}
            <p className="footer-legal">
              Proyecto personal, sin relación con Euroleague Basketball ni con Fantaking. Datos de
              la API pública de la EuroLeague y del EuroLeague Fantasy Challenge.
            </p>
            <p className="footer-meta">
              <span>
                Datos del {dateTime(meta.generatedAt)}
                {meta.lastPriceCapture ? ` · precios del ${dateTime(meta.lastPriceCapture)}` : ""}
                {checkedLater(meta) && meta.lastPriceCheck
                  ? `, comprobados el ${dateTime(meta.lastPriceCheck)}`
                  : ""}
              </span>
              <a href="/metodologia">Cómo se calcula</a>
              <a href="/acierta">¿Acierta HoopIQ?</a>
            </p>
          </div>
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}
