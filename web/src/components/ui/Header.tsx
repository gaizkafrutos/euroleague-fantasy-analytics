"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import PlayerSearch from "./PlayerSearch";
import { NAV_ITEMS, isCurrent } from "./nav-items";

interface Props {
  round: number;
  totalRounds: number;
}

export default function Header({ round, totalRounds }: Props) {
  const pathname = usePathname();

  return (
    <header className="masthead">
      <div className="shell masthead-inner">
        <Link href="/" className="wordmark" aria-label="HoopIQ, inicio">
          {/* El símbolo del logotipo original, partido en dos máscaras (aro y
              barras) que el CSS pinta con tokens: sigue a la paleta y al tema. */}
          <span className="wordmark-mark" aria-hidden>
            <i className="mark-ring" />
            <i className="mark-bars" />
          </span>
          <span className="wordmark-text">
            <span className="wordmark-name">
              Hoop<span className="wordmark-iq">IQ</span>
            </span>
            <span className="wordmark-sub">Fantasy Challenge</span>
          </span>
        </Link>

        {/* En el móvil la navegación baja a la barra inferior: ahí se llega con
            el pulgar, y arriba no hay sitio para cuatro palabras. */}
        <nav className="nav" aria-label="Principal">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <PlayerSearch />

        <div className="masthead-tools">
          <span className="round-pill">
            Jornada <b>{round}</b>
            <span className="muted">/ {totalRounds}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
