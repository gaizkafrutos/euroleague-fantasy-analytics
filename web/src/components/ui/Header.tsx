"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
        <Link href="/" className="wordmark" aria-label="Euroanalysis, inicio">
          <span className="wordmark-mark" aria-hidden>
            {/* Tres barras ascendentes: análisis y progresión. Un símbolo
                dibujado se lee como marca; un círculo con CSS, no. */}
            <svg viewBox="0 0 20 20" fill="none">
              <rect x="2" y="11" width="3.6" height="7" rx="1.2" fill="#fff" opacity="0.62" />
              <rect x="8.2" y="6.5" width="3.6" height="11.5" rx="1.2" fill="#fff" opacity="0.82" />
              <rect x="14.4" y="2" width="3.6" height="16" rx="1.2" fill="#fff" />
            </svg>
          </span>
          <span className="wordmark-text">
            <span className="wordmark-name">Euroanalysis</span>
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
          <ThemeToggle />
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
