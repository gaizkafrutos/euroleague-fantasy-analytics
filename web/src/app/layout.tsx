import type { Metadata, Viewport } from "next";

import Header from "@/components/ui/Header";
import MobileNav from "@/components/ui/MobileNav";
import { meta } from "@/lib/data";
import { body, display } from "@/lib/fonts";

import "./globals.css";

/** La URL absoluta del sitio, necesaria para que la tarjeta de compartir
 *  apunte a una imagen real. Vercel inyecta el dominio de producción solo. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Euroanalysis — análisis del EuroLeague Fantasy Challenge",
    template: "%s · Euroanalysis",
  },
  description:
    "Cruce de los precios del EuroLeague Fantasy Challenge con las estadísticas oficiales de la EuroLiga: valor por crédito, tendencias de precio, consistencia y cambios de rol.",
  applicationName: "Euroanalysis",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Euroanalysis",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Euroanalysis",
    description:
      "Chollos, subidas de precio y cambios de rol en el EuroLeague Fantasy Challenge, con datos reales.",
    type: "website",
    locale: "es_ES",
    siteName: "Euroanalysis",
  },
  twitter: {
    card: "summary_large_image",
    title: "Euroanalysis",
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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c11" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

/** Fija el tema antes del primer pintado, para que no haya un destello de
 *  blanco al cargar con el tema oscuro guardado. */
const THEME_BOOTSTRAP = `
try {
  var stored = localStorage.getItem('efa-theme');
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido
        </a>
        <Header round={meta.currentRound} totalRounds={meta.totalRounds} />
        <main id="contenido">{children}</main>
        <footer className="footer">
          <div className="shell">
            <p style={{ margin: 0, maxWidth: "76ch" }}>
              Proyecto personal, sin ánimo comercial y sin relación con Euroleague Basketball
              ni con Fantaking. Estadísticas de la API pública de la EuroLeague; precios del
              EuroLeague Fantasy Challenge.
            </p>
            <p style={{ margin: "8px 0 0" }} className="num">
              Datos generados el {new Date(meta.generatedAt).toLocaleString("es-ES")} ·{" "}
              <a href="/metodologia">Cómo se calcula todo</a>
            </p>
          </div>
        </footer>
        <MobileNav />
      </body>
    </html>
  );
}
