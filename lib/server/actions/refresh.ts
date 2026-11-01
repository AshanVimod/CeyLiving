import "server-only";
import { revalidatePath, updateTag } from "next/cache";
import { CATALOGUE_TAG } from "../catalogue-tag";

/**
 * After a change that public pages show (an item, a shop, a review, a question, a moderation decision or an
 * anonymised author): expires the cached catalogue snapshot (lib/server/catalogue.ts), so the next visit reads
 * fresh rows, and refreshes every page, so the person sees their own change at once.
 */
export function refreshEverything(): void {
  updateTag(CATALOGUE_TAG);
  revalidatePath("/", "layout");
}
