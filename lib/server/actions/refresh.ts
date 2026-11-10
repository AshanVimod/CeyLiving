import "server-only";
import { refresh, updateTag } from "next/cache";
import { tagsFor, type CatalogueChange } from "../catalogue-tag";

/**
 * BE-09 (B13): after a change that public pages show, expires only the cached catalogue reads it affects
 * (lib/server/catalogue-tag.ts). updateTag is for server actions: the next visit, the person's own included, waits
 * for fresh rows instead of being served the old ones. Call it after the change is saved: a failed change refreshes
 * nothing.
 */
export function refreshCatalogue(change: CatalogueChange): void {
  for (const tag of tagsFor(change)) updateTag(tag);
}

/**
 * After a change that no cached read shows (a question, an answer, a vote, a report, a notification, payouts):
 * re-renders the person's current page so they see it, and leaves every cache alone.
 */
export function refreshPage(): void {
  refresh();
}
