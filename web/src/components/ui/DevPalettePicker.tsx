"use client";

/** Selector temporal de paleta y tema, solo en desarrollo.
 *
 *  Sirve para comparar las paletas candidatas en vivo sobre las mismas
 *  pantallas. Escribe `data-palette` y `data-theme` en <html> (el CSS hace el
 *  resto) y lo recuerda en localStorage. Cuando se elija paleta y tema, este
 *  componente y los bloques que sobren en globals.css se borran.
 */
import { useEffect, useState } from "react";

import { DEV_PALETTE_KEY, DEV_THEME_KEY, PALETTES, type PaletteId } from "@/lib/palettes";

type Theme = "light" | "dark";

export default function DevPalettePicker() {
  const [palette, setPalette] = useState<PaletteId>(PALETTES[0].id);
  const [theme, setTheme] = useState<Theme>("light");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const storedPalette = root.dataset.palette as PaletteId | undefined;
    if (storedPalette && PALETTES.some((item) => item.id === storedPalette)) {
      setPalette(storedPalette);
    }
    if (root.dataset.theme === "dark") setTheme("dark");
  }, []);

  function apply(nextPalette: PaletteId, nextTheme: Theme) {
    const root = document.documentElement;
    setPalette(nextPalette);
    setTheme(nextTheme);
    if (nextPalette === PALETTES[0].id) delete root.dataset.palette;
    else root.dataset.palette = nextPalette;
    if (nextTheme === "dark") root.dataset.theme = "dark";
    else delete root.dataset.theme;
    try {
      window.localStorage.setItem(DEV_PALETTE_KEY, nextPalette);
      window.localStorage.setItem(DEV_THEME_KEY, nextTheme);
    } catch {
      /* modo privado: no se recuerda, pero se aplica */
    }
  }

  const current = PALETTES.find((item) => item.id === palette) ?? PALETTES[0];

  return (
    <div className="devpal" data-open={open || undefined}>
      <button
        type="button"
        className="devpal-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="devpal-swatch" aria-hidden />
        {current.label} · {theme === "dark" ? "oscuro" : "claro"}
      </button>
      {open ? (
        <div className="devpal-panel" role="group" aria-label="Paleta y tema (solo desarrollo)">
          <p className="devpal-title">Paleta · solo desarrollo</p>
          <ul className="devpal-list">
            {PALETTES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === palette}
                  onClick={() => apply(item.id, theme)}
                >
                  <b>{item.label}</b>
                  <span>{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="segmented" role="group" aria-label="Tema">
            {(["light", "dark"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => apply(palette, value)}
              >
                {value === "light" ? "Claro" : "Oscuro"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
