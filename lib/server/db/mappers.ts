import "server-only";
import type { Address, AuditLogEntry, Notification, RateEvent, SellerApplication, User } from "@/lib/types";
import type * as Row from "./generated/client";

// BE-01: PostgreSQL rows become the domain types in lib/types.ts here, so nothing above the repositories sees Prisma.
// Times become ISO strings and NULL becomes an absent field, exactly as the dev store holds them.

const iso = (date: Date) => date.toISOString();
const optIso = (date: Date | null) => (date ? date.toISOString() : undefined);
const opt = <T>(value: T | null) => value ?? undefined;

/** Turns an ISO string from a service into a column value; `undefined` stays "not given". */
export const toDate = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/**
 * For updates: Prisma skips `undefined`, but a patch key set to `undefined` means "clear it" in the dev store.
 * Returns the patch with those keys set to null.
 */
export function clearing<P extends object>(patch: P): { [K in keyof P]: Exclude<P[K], undefined> | null } {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value ?? null])) as never;
}

export function toUser(row: Row.User): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: opt(row.phone),
    role: row.role,
    emailVerified: row.emailVerified,
    postingRestriction: row.postingRestriction,
    mutedUntil: optIso(row.mutedUntil),
    restrictionReason: opt(row.restrictionReason),
    createdAt: iso(row.createdAt),
    deletedAt: optIso(row.deletedAt),
  };
}

export function toApplication(row: Row.SellerApplication): SellerApplication {
  return {
    id: row.id,
    userId: row.userId,
    applicantName: row.applicantName,
    phone: row.phone,
    businessType: row.businessType,
    businessRegNo: opt(row.businessRegNo),
    shopName: row.shopName,
    craft: row.craft,
    categorySlugs: row.categorySlugs,
    address: {
      line1: row.addressLine1,
      line2: opt(row.addressLine2),
      city: row.addressCity,
      district: row.addressDistrict,
      postalCode: opt(row.addressPostalCode),
    },
    story: row.story,
    workPhotoUrls: row.workPhotoUrls,
    socialUrl: opt(row.socialUrl),
    acceptedTermsAt: iso(row.acceptedTermsAt),
    status: row.status,
    adminNote: opt(row.adminNote),
    decidedById: opt(row.decidedById),
    decidedAt: optIso(row.decidedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The flat columns for a SellerApplication (or a patch of one). */
export function applicationColumns(app: Partial<SellerApplication>) {
  const { address, acceptedTermsAt, decidedAt, createdAt, updatedAt, ...rest } = app;
  return {
    ...rest,
    ...(address && {
      addressLine1: address.line1,
      addressLine2: address.line2 ?? null,
      addressCity: address.city,
      addressDistrict: address.district,
      addressPostalCode: address.postalCode ?? null,
    }),
    ...("acceptedTermsAt" in app && { acceptedTermsAt: toDate(acceptedTermsAt) }),
    ...("decidedAt" in app && { decidedAt: toDate(decidedAt) }),
    ...("createdAt" in app && { createdAt: toDate(createdAt) }),
    ...("updatedAt" in app && { updatedAt: toDate(updatedAt) }),
  };
}

export function toAddress(row: Row.Address): Address {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    recipientName: row.recipientName,
    line1: row.line1,
    line2: opt(row.line2),
    city: row.city,
    district: row.district,
    postalCode: opt(row.postalCode),
    phone: row.phone,
  };
}

export function toNotification(row: Row.Notification): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    href: row.href,
    readAt: optIso(row.readAt),
    createdAt: iso(row.createdAt),
  };
}

export function toAuditEntry(row: Row.AuditLogEntry): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: opt(row.reason),
    before: opt(row.before),
    after: opt(row.after),
    createdAt: iso(row.createdAt),
  };
}

export function toRateEvent(row: Row.RateEvent): RateEvent {
  return { userId: row.userId, kind: row.kind, at: iso(row.at) };
}
