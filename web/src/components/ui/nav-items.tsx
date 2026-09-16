/** Las cuatro secciones, en un solo sitio: las usan la cabecera y la barra
 *  inferior del móvil, y tienen que decir exactamente lo mismo. */

export interface NavItem {
  href: string;
  label: string;
  /** Etiqueta corta para la barra del móvil, donde no cabe "Metodología". */
  short: string;
  icon: "market" | "squad" | "teams" | "method";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Mercado", short: "Mercado", icon: "market" },
  { href: "/mi-equipo", label: "Mi equipo", short: "Mi equipo", icon: "squad" },
  { href: "/equipos", label: "Equipos", short: "Equipos", icon: "teams" },
  { href: "/metodologia", label: "Metodología", short: "Método", icon: "method" },
];

export function NavIcon({ name }: { name: NavItem["icon"] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {name === "market" ? (
        <>
          <path d="M4 20V13.5" />
          <path d="M10 20V8.5" />
          <path d="M16 20V4.5" />
          <path d="M21 20H3" />
        </>
      ) : null}
      {name === "squad" ? (
        <>
          <circle cx="12" cy="8.2" r="3.4" />
          <path d="M5 20c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8" />
        </>
      ) : null}
      {name === "teams" ? (
        <>
          <path d="M12 3.2 19 6v5.4c0 4.1-2.8 7.5-7 9.4-4.2-1.9-7-5.3-7-9.4V6z" />
          <path d="M9.4 12.1l1.8 1.8 3.4-3.6" />
        </>
      ) : null}
      {name === "method" ? (
        <>
          <path d="M5 5.2A2.2 2.2 0 0 1 7.2 3H19v15.2H7.2A2.2 2.2 0 0 0 5 20.4z" />
          <path d="M9 7.6h6M9 11h4.2" />
        </>
      ) : null}
    </svg>
  );
}

/** ¿Este enlace corresponde a la ruta actual? */
export function isCurrent(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/jugador");
  return pathname === href || pathname.startsWith(`${href}/`);
}
