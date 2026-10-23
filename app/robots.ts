import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

/** Feature-02: the public demo asks search engines to stay away; otherwise everything may be crawled. */
export default function robots(): MetadataRoute.Robots {
  return getEnv().DEMO_MODE ? { rules: { userAgent: "*", disallow: "/" } } : { rules: { userAgent: "*", allow: "/" } };
}
