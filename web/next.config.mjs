/** Cabeceras de seguridad. La web es estática y no carga nada de terceros
 *  salvo las fotos y escudos de los CDN oficiales, así que la política puede
 *  ser corta. `unsafe-inline` hace falta: Next incrusta el estado de cada
 *  página en scripts en línea y las páginas estáticas no pueden llevar nonce.
 *  En desarrollo no se aplica (la recarga en caliente usa eval y websockets). */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://media-cdn.incrowdsports.com https://media-cdn.cortextech.io",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    // Los escudos y fotos vienen de los CDN oficiales de la EuroLeague.
    remotePatterns: [
      { protocol: "https", hostname: "media-cdn.incrowdsports.com" },
      { protocol: "https", hostname: "media-cdn.cortextech.io" },
    ],
    // Plan Hobby: 5K transformaciones/mes. Pocos anchos = pocas variantes por
    // imagen; los anchos son de los valores por defecto para reutilizar caché.
    imageSizes: [128, 256],
    deviceSizes: [384, 750],
    // Los CDN mandan max-age de 1 día y cada variante se re-transformaba a
    // diario. Las URLs llevan UUID (contenido inmutable): cachear 30 días.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
