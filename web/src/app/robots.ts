import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Todo es público: solo se aparta la API de la plantilla personal. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
