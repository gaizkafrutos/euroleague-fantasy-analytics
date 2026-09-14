import type { Metadata } from "next";

import Header from "@/components/ui/Header";
import { body, display } from "@/lib/fonts";
import { meta } from "@/lib/data";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fantasy/EuroLeague — análisis del Fantasy Challenge",
    template: "%s · Fantasy/EuroLeague",
  },
  description:
    "Cruce de los precios del EuroLeague Fantasy Challenge con las estadísticas oficiales de la EuroLeague: valor por crédito, tendencias de precio, consistencia y cambios de rol.",
  openGraph: {
    title: "Fantasy/EuroLeague",
    description:
      "Chollos, subidas de precio y cambios de rol en el EuroLeague Fantasy Challenge, con datos reales.",
    type: "website",
  },
};

/** Fija el tema antes del primer pintado, para que no haya un flash de blanco
 *  al cargar con el tema oscuro guardado. */
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
        <Header />
        <main>{children}</main>
        <footer className="footer">
          <div className="shell">
            <p style={{ margin: 0 }}>
              Proyecto personal, sin ánimo comercial y sin relación con Euroleague Basketball ni
              con Fantaking. Estadísticas de la API pública de la EuroLeague; precios del
              EuroLeague Fantasy Challenge.
            </p>
            <p style={{ margin: "6px 0 0" }} className="num">
              Datos generados el {new Date(meta.generatedAt).toLocaleString("es-ES")} ·{" "}
              <a href="/metodologia">Cómo se calcula todo</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
