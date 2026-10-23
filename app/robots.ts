import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

/** Signed-in areas and the JSON API aren't for search engines (they redirect or need a session anyway). */
const PRIVATE_PATHS = ["/account", "/seller", "/admin", "/sell/apply", "/checkout", "/api/"];

export default function robots(): MetadataRoute.Robots {
  const site = getEnv().SITE_URL;
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${site}/sitemap.xml`,
  };
}
