import type { MetadataRoute } from "next";
import { PUBLIC_PAGES } from "@/lib/config";
import { categories } from "@/lib/data/categories";
import { getEnv } from "@/lib/env";
import { publicProductSlugs, publicShops } from "@/lib/server/catalogue";

/**
 * FR-2c / RULE-P4 / RULE-S4: only ACTIVE items of ACTIVE shops are listed, read from the same cached snapshot as
 * the catalogue, so a suspended shop or a hidden item drops out of the sitemap too.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getEnv().SITE_URL;
  const [products, shops] = await Promise.all([publicProductSlugs(), publicShops()]);
  return [
    ...PUBLIC_PAGES.map((path) => ({ url: `${site}${path === "/" ? "" : path}` })),
    ...categories.map((c) => ({ url: `${site}/c/${c.slug}` })),
    ...shops.map((s) => ({ url: `${site}/shop/${s.slug}`, lastModified: s.updatedAt })),
    ...products.map((p) => ({ url: `${site}/p/${p.slug}`, lastModified: p.updatedAt })),
  ];
}
