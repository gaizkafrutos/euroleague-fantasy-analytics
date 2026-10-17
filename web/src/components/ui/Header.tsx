"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { SearchEntry } from "@/lib/search";

import PlayerSearch from "./PlayerSearch";
import { NAV_ITEMS, isCurrent } from "./nav-items";

interface Props {
  round: number;
  totalRounds: number;
  searchIndex: SearchEntry[];
}

export default function Header({ round, totalRounds, searchIndex }: Props) {
  const pathname = usePathname();
  // En la portada la cabecera es transparente sobre el vídeo; al bajar, el
  // texto del relato pasaba por debajo del logo. Pasado el primer tramo se
  // vuelve opaca.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`masthead${scrolled ? " is-scrolled" : ""}`}>
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

        <PlayerSearch index={searchIndex} />

        <div className="masthead-tools">
          <span
            className="round-pill"
            aria-label={`Jornada ${round} de ${totalRounds}`}
            title={`Jornada ${round} de ${totalRounds}`}
          >
            <span className="round-word">Jornada</span>
            <span className="round-short" aria-hidden>
              J
            </span>
            <b>{round}</b>
            <span className="muted">/ {totalRounds}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
