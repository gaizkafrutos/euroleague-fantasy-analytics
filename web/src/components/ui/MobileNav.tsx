"use client";

/** Barra de navegación inferior, solo en móvil.
 *
 *  Es donde llega el pulgar. Una web que se consulta de pie, en el metro, con
 *  una mano, no puede tener la navegación pegada al borde superior de una
 *  pantalla de seis pulgadas.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, NavIcon, isCurrent } from "./nav-items";

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="tabbar" aria-label="Navegación principal">
      {NAV_ITEMS.map((item) => {
        const current = isCurrent(item.href, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="tabbar-item"
            aria-current={current ? "page" : undefined}
          >
            <NavIcon name={item.icon} />
            <span>{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}
