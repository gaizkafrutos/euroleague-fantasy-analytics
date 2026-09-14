/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Los escudos y fotos vienen de los CDN oficiales de la EuroLeague.
    remotePatterns: [
      { protocol: "https", hostname: "media-cdn.incrowdsports.com" },
      { protocol: "https", hostname: "media-cdn.cortextech.io" },
    ],
  },
};

export default nextConfig;
