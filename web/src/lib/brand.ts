/** Colores de marca para las imágenes que se generan en el servidor (tarjeta
 *  de compartir, iconos). Esas imágenes no leen los tokens CSS, así que aquí se
 *  repite la paleta por defecto (Parquet) en su versión oscura. Si cambia la
 *  paleta elegida, se cambia aquí también. */
export const BRAND_RASTER = {
  bg: "#141210",
  ink: "#f4f1ed",
  ink2: "#cbc3ba",
  ink3: "#a1978c",
  brand: "#f47a2e",
} as const;

/** Símbolo compuesto en plano: aro en tinta, barras en el color de marca. */
export const MARK_ON_DARK = "public/brand/mark-on-dark.png";
