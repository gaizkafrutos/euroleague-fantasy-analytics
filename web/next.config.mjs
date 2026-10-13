/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
