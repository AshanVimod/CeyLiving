import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

/** Signed-in areas and the JSON API aren't for search engines (they redirect or need a session anyway). */
const PRIVATE_PATHS = ["/account", "/seller", "/admin", "/sell/apply", "/checkout", "/api/"];

/** Feature-02: the public demo asks every search engine to stay away; the real site lists its sitemap. */
export default function robots(): MetadataRoute.Robots {
  const { DEMO_MODE, SITE_URL } = getEnv();
  if (DEMO_MODE) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
