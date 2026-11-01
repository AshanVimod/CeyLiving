import "server-only";
import type {
  Address,
  AuditLogEntry,
  Category,
  CustomizationField,
  CustomRequest,
  HelpfulVote,
  Material,
  Notification,
  Order,
  OrderItem,
  Payout,
  Photo,
  Product,
  ProductAnswer,
  ProductQuestion,
  ProductVariant,
  RateEvent,
  Report,
  Review,
  SellerApplication,
  SellerOrder,
  Shop,
  User,
} from "@/lib/types";
import type * as Row from "./generated/client";
import type { Prisma } from "./generated/client";

// BE-01: PostgreSQL rows become the domain types in lib/types.ts here, so nothing above the repositories sees Prisma.
// Times become ISO strings and NULL becomes an absent field.

const iso = (date: Date) => date.toISOString();
const optIso = (date: Date | null) => (date ? date.toISOString() : undefined);
const opt = <T>(value: T | null) => value ?? undefined;

/** Turns an ISO string from a service into a column value; `undefined` stays "not given". */
export const toDate = (value: string | undefined) => (value === undefined ? undefined : new Date(value));

/** Column values for a domain object or patch: each listed ISO-string key that is present becomes a Date. */
export function withDates<T extends object>(value: T, keys: readonly (keyof T & string)[]): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of keys) if (key in value) columns[key] = toDate(value[key] as string | undefined);
  return columns;
}

/** A copy of `columns` without the listed keys (fields stored elsewhere or not stored at all). */
function without(columns: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const rest = { ...columns };
  for (const key of keys) delete rest[key];
  return rest;
}

/**
 * For updates: Prisma skips `undefined`, but in a repository patch a key set to `undefined` means "clear it".
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

export function toCategoryColumns(category: Category, sortOrder: number): Prisma.CategoryCreateManyInput {
  const columns = { ...without({ ...category }, ["photo"]), photoId: category.photo.id, photoAlt: category.photo.alt };
  return { ...columns, sortOrder } as Prisma.CategoryCreateManyInput;
}

// ---------- Shops ----------

const photo = (id: string, alt: string): Photo => ({ id, alt });

export function toShop(row: Row.Shop): Shop {
  return {
    id: row.id,
    ownerId: row.ownerId,
    slug: row.slug,
    name: row.name,
    ownerName: row.ownerName,
    district: row.district,
    craft: row.craft,
    story: row.story,
    quote: row.quote,
    since: row.since,
    isVerified: row.isVerified,
    logo: photo(row.logoPhotoId, row.logoAlt),
    banner: photo(row.bannerPhotoId, row.bannerAlt),
    portrait: row.portraitPhotoId ? photo(row.portraitPhotoId, row.portraitAlt ?? "") : undefined,
    dispatchDays: row.dispatchDays,
    returnPolicy: row.returnPolicy,
    status: row.status,
    statusReason: opt(row.statusReason),
    payoutAccountMasked: opt(row.payoutAccountMasked),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The flat columns for a Shop (or a patch of one). A patch with `portrait: undefined` clears the portrait. */
export function shopColumns(shop: Partial<Shop>): Record<string, unknown> {
  const { logo, banner, portrait } = shop;
  return {
    ...without(withDates(shop, ["createdAt", "updatedAt"]), ["logo", "banner", "portrait"]),
    ...(logo && { logoPhotoId: logo.id, logoAlt: logo.alt }),
    ...(banner && { bannerPhotoId: banner.id, bannerAlt: banner.alt }),
    ...("portrait" in shop && { portraitPhotoId: portrait?.id ?? null, portraitAlt: portrait?.alt ?? null }),
  };
}

// ---------- Products ----------

/** What every product query loads: the shop's slug and the child rows, in their stored order. */
export const productInclude = {
  shop: { select: { slug: true } },
  images: { orderBy: { position: "asc" } },
  variants: { orderBy: { position: "asc" } },
  customization: { orderBy: { position: "asc" } },
} as const satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** `publishedAt` is a DATE column; the app holds it as YYYY-MM-DD. */
const day = (date: Date) => date.toISOString().slice(0, 10);

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shopSlug: row.shop.slug,
    categorySlug: row.categorySlug,
    subcategory: row.subcategory,
    description: row.description,
    materials: row.materials as Material[],
    materialNote: row.materialNote,
    styles: row.styles,
    tags: row.tags,
    type: row.type,
    processingDays: opt(row.processingDays),
    isCustomizable: row.isCustomizable,
    isHeritage: row.isHeritage,
    isEcoFriendly: row.isEcoFriendly,
    featuredRank: opt(row.featuredRank),
    publishedAt: day(row.publishedAt),
    dimensions: row.dimensions,
    care: row.care,
    images: row.images.map((i) => photo(i.photoId, i.alt)),
    variants: row.variants.map((v): ProductVariant => ({
      sku: v.sku,
      label: v.label,
      priceCents: v.priceCents,
      compareAtPriceCents: opt(v.compareAtPriceCents),
      stock: v.stock,
    })),
    // No stored fields reads back as absent: the app treats a missing list and an empty one alike.
    customization: row.customization.length
      ? row.customization.map((f): CustomizationField => ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          options: f.kind === "SELECT" ? f.options : undefined,
          maxLength: f.maxLength,
          isRequired: f.isRequired,
          helper: opt(f.helper),
        }))
      : undefined,
    status: row.status,
    rejectionReason: opt(row.rejectionReason),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** The product's own columns (or a patch of them). The shop link and the child rows are written separately. */
export function productColumns(product: Partial<Product>): Record<string, unknown> {
  const columns = without(withDates(product, ["createdAt", "updatedAt"]), [
    "shopSlug",
    "images",
    "variants",
    "customization",
  ]);
  if ("publishedAt" in product) {
    columns.publishedAt = product.publishedAt && new Date(`${product.publishedAt}T00:00:00.000Z`);
  }
  return columns;
}

export const imageRows = (productId: string, images: Photo[]) =>
  images.map((image, position) => ({ productId, position, photoId: image.id, alt: image.alt }));

export const variantRows = (productId: string, variants: ProductVariant[]) =>
  variants.map((variant, position) => ({ productId, position, ...variant }));

export const customizationRows = (productId: string, fields: CustomizationField[]) =>
  fields.map((field, position) => ({ productId, position, ...field, options: field.options ?? [] }));

// ---------- Content ----------

export function toReview(row: Row.Review): Review {
  return {
    id: row.id,
    productId: row.productId,
    shopId: row.shopId,
    orderItemId: opt(row.orderItemId),
    authorId: row.authorId,
    authorName: row.authorName,
    rating: row.rating,
    comment: opt(row.comment),
    status: row.status,
    statusReason: opt(row.statusReason),
    sellerReply: opt(row.sellerReply),
    sellerRepliedAt: optIso(row.sellerRepliedAt),
    ceylivingReply: opt(row.ceylivingReply),
    createdAt: iso(row.createdAt),
    editedAt: optIso(row.editedAt),
  };
}

export const reviewColumns = (review: Partial<Review>) =>
  withDates(review, ["sellerRepliedAt", "createdAt", "editedAt"]);

export function toQuestion(row: Row.ProductQuestion): ProductQuestion {
  return {
    id: row.id,
    productId: row.productId,
    shopId: row.shopId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    status: row.status,
    statusReason: opt(row.statusReason),
    createdAt: iso(row.createdAt),
  };
}

export function toAnswer(row: Row.ProductAnswer): ProductAnswer {
  return {
    id: row.id,
    questionId: row.questionId,
    authorId: row.authorId,
    authorRole: row.authorRole,
    body: row.body,
    status: row.status,
    statusReason: opt(row.statusReason),
    createdAt: iso(row.createdAt),
  };
}

export function toReport(row: Row.Report): Report {
  return {
    id: row.id,
    reporterId: row.reporterId,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    details: opt(row.details),
    status: row.status,
    resolvedById: opt(row.resolvedById),
    resolution: opt(row.resolution),
    createdAt: iso(row.createdAt),
  };
}

export function toVote(row: Row.HelpfulVote): HelpfulVote {
  return { userId: row.userId, targetType: row.targetType, targetId: row.targetId, createdAt: iso(row.createdAt) };
}

// ---------- Commerce ----------

export function toOrder(row: Row.Order): Order {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    shippingAddress: row.shippingAddress as unknown as Order["shippingAddress"],
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    totalCents: row.totalCents,
    placedAt: iso(row.placedAt),
  };
}

/** The columns for an Order (or a patch of one). The shipping address is a JSON snapshot taken at checkout. */
export const orderColumns = (order: Partial<Order>) => withDates(order, ["placedAt"]);

export function toSellerOrder(row: Row.SellerOrder): SellerOrder {
  return {
    id: row.id,
    orderId: row.orderId,
    shopId: row.shopId,
    status: row.status,
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    courierName: opt(row.courierName),
    trackingRef: opt(row.trackingRef),
    cancelReason: opt(row.cancelReason),
    acceptedAt: optIso(row.acceptedAt),
    dispatchedAt: optIso(row.dispatchedAt),
    completedAt: optIso(row.completedAt),
    updatedAt: iso(row.updatedAt),
    payoutId: opt(row.payoutId),
  };
}

export const sellerOrderColumns = (so: Partial<SellerOrder>) =>
  withDates(so, ["acceptedAt", "dispatchedAt", "completedAt", "updatedAt"]);

export function toOrderItem(row: Row.OrderItem): OrderItem {
  return {
    id: row.id,
    sellerOrderId: row.sellerOrderId,
    productId: row.productId,
    variantSku: row.variantSku,
    productTitle: row.productTitle,
    variantLabel: row.variantLabel,
    unitPriceCents: row.unitPriceCents,
    quantity: row.quantity,
  };
}

/** What every payout query loads: the ids of the seller orders it pays, oldest first. */
export const payoutInclude = {
  sellerOrders: { select: { id: true }, orderBy: [{ completedAt: "asc" }, { id: "asc" }] },
} as const satisfies Prisma.PayoutInclude;

export type PayoutRow = Prisma.PayoutGetPayload<{ include: typeof payoutInclude }>;

export function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    shopId: row.shopId,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    sellerOrderIds: row.sellerOrders.map((so) => so.id),
    grossCents: row.grossCents,
    commissionCents: row.commissionCents,
    refundsCents: row.refundsCents,
    netCents: row.netCents,
    status: row.status,
    paidAt: optIso(row.paidAt),
    reference: opt(row.reference),
    createdAt: iso(row.createdAt),
  };
}

/** `sellerOrderIds` is not stored: it is the seller orders whose payout_id points here. */
export const payoutColumns = (payout: Partial<Payout>) =>
  without(withDates(payout, ["periodStart", "periodEnd", "paidAt", "createdAt"]), ["sellerOrderIds"]);

export function toCustomRequest(row: Row.CustomRequest): CustomRequest {
  const quoted = row.quotePriceCents !== null && row.quoteDays !== null && row.quotedAt !== null;
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    shopId: row.shopId,
    message: row.message,
    budgetCents: opt(row.budgetCents),
    status: row.status,
    quote: quoted
      ? {
          priceCents: row.quotePriceCents!,
          days: row.quoteDays!,
          message: opt(row.quoteMessage),
          quotedAt: iso(row.quotedAt!),
        }
      : undefined,
    declineReason: opt(row.declineReason),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function customRequestColumns(request: Partial<CustomRequest>): Record<string, unknown> {
  const { quote } = request;
  return {
    ...without(withDates(request, ["createdAt", "updatedAt"]), ["quote"]),
    ...("quote" in request && {
      quotePriceCents: quote?.priceCents ?? null,
      quoteDays: quote?.days ?? null,
      quoteMessage: quote?.message ?? null,
      quotedAt: quote ? new Date(quote.quotedAt) : null,
    }),
  };
}
