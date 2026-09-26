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

  return (
    <header className="masthead">
      <div className="shell masthead-inner">
        <Link href="/" className="wordmark" aria-label="HoopIQ, inicio">
          <span className="wordmark-mark" aria-hidden>
            {/* El símbolo es el del logotipo original. Dos versiones: trazo
                blanco para fondo oscuro y trazo tinta para el tema claro. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark-on-dark" src="/brand/hoopiq-mark-128.png" alt="" width={32} height={32} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark-on-light" src="/brand/hoopiq-mark-light-128.png" alt="" width={32} height={32} />
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
          <span className="round-pill" aria-label={`Jornada ${round} de ${totalRounds}`}>
            <span className="round-word">Jornada</span>
            <span className="round-short" aria-hidden>
              J
            </span>
            <b>{round}</b>
            <span className="muted">/ {totalRounds}</span>
          </span>
          {/* La portada es siempre oscura, así que ahí el conmutador no haría
              nada visible. Un botón que no responde es peor que no tenerlo. */}
          {pathname === "/" ? null : <ThemeToggle />}
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("efa-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
    }
  }, []);

  function toggle() {
    const next =
      theme === "dark"
        ? "light"
        : theme === "light"
          ? "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "light"
            : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("efa-theme", next);
    } catch {
      /* modo privado: el tema simplemente no se recuerda */
    }
  }

  return (
    <button
      type="button"
      className="icon-button"
      onClick={toggle}
      aria-label="Cambiar entre tema claro y oscuro"
      title="Cambiar tema"
    >
      {/* Un icono en vez de una palabra: ocupa menos y no compite con la
          navegación por atención. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path
          d="M12 3v1.5M12 19.5V21M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M3 12h1.5M19.5 12H21M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="3.9" />
      </svg>
    </button>
  );
}
