const lkr = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  currencyDisplay: "code",
  maximumFractionDigits: 0,
});

/** Formats integer minor units (cents) as LKR for display only (CS-08). */
export function formatLkr(cents: number): string {
  return lkr.format(cents / 100).replace(/ /g, " ");
}

export function photoUrl(id: string): string {
  return `https://images.unsplash.com/photo-${id}`;
}

const dateFormat = new Intl.DateTimeFormat("en-LK", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Colombo",
});

/** Whole days between `iso` and now (used on request-time pages only). */
export function daysSince(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 86_400_000;
}

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Who made an audited change: the person's name, or CeyLiving itself when a scheduled job did it (B06). */
export function auditActorName(actorId: string | undefined, userNames: ReadonlyMap<string, string>): string {
  return actorId ? (userNames.get(actorId) ?? actorId) : "CeyLiving (scheduled job)";
}
