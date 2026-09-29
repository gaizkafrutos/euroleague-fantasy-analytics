"use client";

/** Selector temporal de paleta, solo en desarrollo.
 *
 *  Sirve para comparar las paletas candidatas en vivo sobre las mismas
 *  pantallas. Escribe `data-palette` en <html> (el CSS hace el resto) y lo
 *  recuerda en localStorage. Cuando se elija paleta, este componente y los
 *  bloques que sobren en globals.css se borran.
 */
import { useEffect, useState } from "react";

import { DEV_PALETTE_KEY, PALETTES, type PaletteId } from "@/lib/palettes";

export default function DevPalettePicker() {
  const [palette, setPalette] = useState<PaletteId>(PALETTES[0].id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = document.documentElement.dataset.palette as PaletteId | undefined;
    if (stored && PALETTES.some((item) => item.id === stored)) setPalette(stored);
  }, []);

  function apply(next: PaletteId) {
    const root = document.documentElement;
    setPalette(next);
    if (next === PALETTES[0].id) delete root.dataset.palette;
    else root.dataset.palette = next;
    try {
      window.localStorage.setItem(DEV_PALETTE_KEY, next);
    } catch {
      /* modo privado: no se recuerda, pero se aplica */
    }
  }

  const current = PALETTES.find((item) => item.id === palette) ?? PALETTES[0];

  return (
    <div className="devpal">
      <button
        type="button"
        className="devpal-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="devpal-swatch" aria-hidden />
        {current.label}
      </button>
      {open ? (
        <div className="devpal-panel" role="group" aria-label="Paleta (solo desarrollo)">
          <p className="devpal-title">Paleta · solo desarrollo</p>
          <ul className="devpal-list">
            {PALETTES.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === palette}
                  onClick={() => apply(item.id)}
                >
                  <b>{item.label}</b>
                  <span>{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
