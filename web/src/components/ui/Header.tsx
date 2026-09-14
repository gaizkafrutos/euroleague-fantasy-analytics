"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/", label: "Mercado" },
  { href: "/mi-equipo", label: "Mi equipo" },
  { href: "/equipos", label: "Equipos" },
  { href: "/metodologia", label: "Metodología" },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="masthead">
      <div className="shell masthead-inner">
        <Link href="/" className="wordmark">
          <span className="wordmark-mark" aria-hidden />
          <span>
            Fantasy<span className="muted">/</span>EuroLeague
          </span>
        </Link>
        <nav className="nav" aria-label="Principal">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={
                link.href === "/" ? (pathname === "/" ? "page" : undefined) : pathname.startsWith(link.href) ? "page" : undefined
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
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
      className="chip"
      onClick={toggle}
      aria-label="Cambiar entre tema claro y oscuro"
      style={{ flex: "none" }}
    >
      {theme === "dark" ? "Claro" : theme === "light" ? "Oscuro" : "Tema"}
    </button>
  );
}
