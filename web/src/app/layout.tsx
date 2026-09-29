import type { Metadata, Viewport } from "next";
import Script from "next/script";

import DevPalettePicker from "@/components/ui/DevPalettePicker";
import Header from "@/components/ui/Header";
import MobileNav from "@/components/ui/MobileNav";
import { meta } from "@/lib/data";
import { body, display } from "@/lib/fonts";
import { DEV_PALETTE_KEY, DEV_THEME_KEY } from "@/lib/palettes";

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
    default: "HoopIQ — análisis del EuroLeague Fantasy Challenge",
    template: "%s · HoopIQ",
  },
  description:
    "Cruce de los precios del EuroLeague Fantasy Challenge con las estadísticas oficiales de la EuroLiga: valor por crédito, tendencias de precio, consistencia y cambios de rol.",
  applicationName: "HoopIQ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "HoopIQ",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "HoopIQ",
    description:
      "Chollos, subidas de precio y cambios de rol en el EuroLeague Fantasy Challenge, con datos reales.",
    type: "website",
    locale: "es_ES",
    siteName: "HoopIQ",
  },
  twitter: {
    card: "summary_large_image",
    title: "HoopIQ",
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
  // El fondo del tema claro, que es el único que ve producción.
  themeColor: "#faf9f7",
};

/** El selector de paletas es solo de desarrollo: en producción manda el tema
 *  claro con la paleta por defecto, sin nada que leer. */
const IS_DEV = process.env.NODE_ENV === "development";

/** En desarrollo, aplica paleta y tema guardados antes del primer pintado,
 *  para que no haya un destello de la paleta por defecto al recargar. */
const DEV_BOOTSTRAP = `
try {
  var p = localStorage.getItem('${DEV_PALETTE_KEY}');
  if (p && p !== 'parquet') document.documentElement.dataset.palette = p;
  if (localStorage.getItem('${DEV_THEME_KEY}') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch (e) {}
`;

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
        {/* Con `next/script` en beforeInteractive, Next lo inyecta en el HTML
            inicial. Un <script> suelto dentro del árbol de React avisa por
            consola de que no se ejecuta al renderizar en cliente. */}
        {IS_DEV ? (
          <Script
            id="paleta-antes-del-primer-pintado"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: DEV_BOOTSTRAP }}
          />
        ) : null}
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
        {IS_DEV ? <DevPalettePicker /> : null}
      </body>
    </html>
  );
}
