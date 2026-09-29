/** Paletas candidatas del rediseño. Los valores viven en globals.css (bloque
 *  generado); aquí solo los nombres, para el selector de desarrollo. La
 *  primera es la de por defecto y la única que ve producción. */
export const PALETTES = [
  { id: "parquet", label: "Parquet", hint: "neutros cálidos" },
  { id: "pista", label: "Pista", hint: "neutros fríos, naranja rojizo" },
  { id: "balon", label: "Balón", hint: "grises puros, naranja vivo" },
  { id: "tinta", label: "Tinta", hint: "casi monocromo" },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

export const DEV_PALETTE_KEY = "hoopiq-dev-palette";
