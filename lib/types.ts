// Mirrors Section 7 of the build spec and Section 6 of the feature spec, shared by every layer.
// IDs are strings, times are ISO 8601 UTC strings, money is integer cents.

export type CategoryGroup = "MODERN" | "TRADITIONAL";
export type Style = "MODERN" | "TRADITIONAL" | "MINIMAL" | "COLOURFUL" | "RUSTIC" | "CULTURAL";
export type ProductType = "READY_TO_SHIP" | "MADE_TO_ORDER";
export type Material = "wood" | "fabric" | "clay" | "resin" | "metal" | "natural-fibre" | "recycled" | "other";

export type Role = "CUSTOMER" | "SELLER" | "ADMIN";
export type ApplicationStatus = "PENDING" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export type ShopStatus = "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";
export type ProductStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "ARCHIVED" | "REMOVED";
export type ContentStatus = "VISIBLE" | "HIDDEN" | "DELETED";
export type SellerOrderStatus =
  "PENDING_PAYMENT" | "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DISPATCHED" | "COMPLETED" | "CANCELLED" | "REFUNDED";
/** B07: PENDING until paid (B08); EXPIRED when not paid in time (BR-06). */
export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "REFUNDED" | "PARTIALLY_REFUNDED";
/** B08 (PAY-05): PayHere's status for one payment. */
export type ProviderPaymentStatus = "SUCCESS" | "PENDING" | "CANCELLED" | "FAILED" | "CHARGEDBACK";
export type RefundStatus = "PENDING" | "SUCCEEDED" | "FAILED";
export type RefundMethod = "PAYHERE" | "MANUAL";
export type ReportStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type PostingRestriction = "NONE" | "MUTED" | "BANNED";
export type ReportTargetType = "PRODUCT" | "SHOP" | "REVIEW" | "QUESTION" | "ANSWER";
export type PayoutStatus = "PENDING" | "SCHEDULED" | "PAID" | "FAILED";
export type CustomRequestStatus = "OPEN" | "QUOTED" | "ACCEPTED" | "DECLINED" | "EXPIRED";
export type UploadPurpose = "PRODUCT_IMAGE" | "SHOP_LOGO" | "SHOP_BANNER" | "APPLICATION_PHOTO";
export type UploadStatus = "PENDING" | "READY" | "REJECTED";

export interface Photo {
  /** Photo id: an upload id (upl_…) or an Unsplash id (lib/photos.ts). */
  id: string;
  alt: string;
}

export interface Category {
  name: string;
  slug: string;
  group: CategoryGroup;
  blurb: string;
  subcategories: string[];
  photo: Photo;
  /** Name in Sinhala, shown only where we are sure of the term. */
  sinhala?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  emailVerified: boolean;
  postingRestriction: PostingRestriction;
  mutedUntil?: string;
  restrictionReason?: string;
  createdAt: string;
  /** Set when the person deletes their account (FR-17); the row stays, anonymised, for order records. */
  deletedAt?: string;
}

export type BusinessType = "INDIVIDUAL" | "REGISTERED_BUSINESS";

/** Where a shop sends its orders from. Only CeyLiving staff and the applicant see it. */
export interface ShopAddress {
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode?: string;
}

/** FR-2a: an application to open a shop. */
export interface SellerApplication {
  id: string;
  userId: string;
  /** About the applicant. */
  applicantName: string;
  phone: string;
  businessType: BusinessType;
  businessRegNo?: string;
  /** About the shop. */
  shopName: string;
  craft: string;
  categorySlugs: string[];
  address: ShopAddress;
  story: string;
  /** 3 to 6 photo ids; application photos are private (applicant and admins only). */
  workPhotoIds: string[];
  socialUrl?: string;
  acceptedTermsAt: string;
  status: ApplicationStatus;
  adminNote?: string;
  decidedById?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shop {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  ownerName: string;
  district: string;
  craft: string;
  story: string;
  quote: string;
  since: number;
  isVerified: boolean;
  logo: Photo;
  banner: Photo;
  portrait?: Photo;
  dispatchDays: string;
  returnPolicy: string;
  status: ShopStatus;
  statusReason?: string;
  /** Masked bank account, e.g. "•••• 4821". Set from the seller's payout details. */
  payoutAccountMasked?: string;
  /** B08 (PAY-05): a chargeback holds the shop's payouts until an admin releases them. */
  payoutHoldReason?: string;
  payoutHeldAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  sku: string;
  label: string;
  priceCents: number;
  compareAtPriceCents?: number;
  stock: number;
}

export interface CustomizationField {
  key: string;
  label: string;
  kind: "TEXT" | "SELECT";
  options?: string[];
  maxLength: number;
  isRequired: boolean;
  helper?: string;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  shopSlug: string;
  categorySlug: string;
  subcategory: string;
  description: string;
  materials: Material[];
  materialNote: string;
  styles: Style[];
  tags: string[];
  type: ProductType;
  processingDays?: number;
  isCustomizable: boolean;
  isHeritage: boolean;
  isEcoFriendly: boolean;
  featuredRank?: number;
  publishedAt: string;
  dimensions: string;
  care: string;
  images: Photo[];
  variants: ProductVariant[];
  customization?: CustomizationField[];
  status: ProductStatus;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  id: string;
  userId: string;
  label: string;
  recipientName: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode?: string;
  phone: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  /** Snapshot taken at checkout; never re-read from the address book. */
  shippingAddress: Omit<Address, "id" | "userId" | "label">;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  placedAt: string;
  paymentStatus: PaymentStatus;
  /** BR-06: when an unpaid order is cancelled and its stock returned. Only orders placed through checkout have one. */
  expiresAt?: string;
  /** B08: when the verified payment notification marked it PAID. */
  paidAt?: string;
}

export interface SellerOrder {
  id: string;
  orderId: string;
  shopId: string;
  status: SellerOrderStatus;
  subtotalCents: number;
  shippingCents: number;
  courierName?: string;
  trackingRef?: string;
  cancelReason?: string;
  acceptedAt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  /** BR-08: a NEW order not accepted by then is cancelled automatically. Set when the order is paid (B08). */
  acceptDeadlineAt?: string;
  updatedAt: string;
  /** The payout this order's earnings were included in (BR-11); each order is paid out once. */
  payoutId?: string;
}

export interface OrderItem {
  id: string;
  sellerOrderId: string;
  productId: string;
  variantSku: string;
  productTitle: string;
  variantLabel: string;
  unitPriceCents: number;
  quantity: number;
  /** BR-16: what the customer asked for, by the field's label at checkout (checked against the item's fields). */
  customization?: Record<string, string>;
}

export interface Review {
  id: string;
  productId: string;
  shopId: string;
  /** Present only for reviews tied to a delivered order item (RULE-R1). */
  orderItemId?: string;
  authorId: string;
  authorName: string;
  rating: number;
  comment?: string;
  status: ContentStatus;
  statusReason?: string;
  sellerReply?: string;
  sellerRepliedAt?: string;
  /** Official reply from the CeyLiving team (admins can reply, never edit). */
  ceylivingReply?: string;
  createdAt: string;
  editedAt?: string;
}

export interface ProductQuestion {
  id: string;
  productId: string;
  shopId: string;
  authorId: string;
  authorName: string;
  body: string;
  status: ContentStatus;
  statusReason?: string;
  createdAt: string;
}

export interface ProductAnswer {
  id: string;
  questionId: string;
  authorId: string;
  authorRole: "SELLER" | "ADMIN";
  body: string;
  status: ContentStatus;
  statusReason?: string;
  createdAt: string;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details?: string;
  status: ReportStatus;
  resolvedById?: string;
  resolution?: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  /** Missing when the worker made the change (a scheduled job, B06); the reason names the job. */
  actorId?: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  href: string;
  readAt?: string;
  createdAt: string;
}

/** Build spec BR-10 / BR-11 and feature spec FR-13: one weekly statement per shop. */
export interface Payout {
  id: string;
  shopId: string;
  periodStart: string;
  periodEnd: string;
  sellerOrderIds: string[];
  grossCents: number;
  commissionCents: number;
  refundsCents: number;
  netCents: number;
  status: PayoutStatus;
  paidAt?: string;
  reference?: string;
  createdAt: string;
}

/** B08 (PAY-03, PAY-04): one PayHere payment, from its verified notification. Never holds card details (PAY-01). */
export interface Payment {
  id: string;
  orderId: string;
  provider: "PAYHERE";
  providerPaymentId: string;
  amountCents: number;
  currency: string;
  status: ProviderPaymentStatus;
  statusCode: number;
  method?: string;
  /** PAY-06: why this money can't go to its order; an admin refunds it. */
  needsRefundReason?: string;
  refundedCents: number;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** B08 (PAY-07, BR-18): money given back by an admin, for one seller order or a whole unusable payment. */
export interface Refund {
  id: string;
  paymentId: string;
  sellerOrderId?: string;
  amountCents: number;
  /** What the seller gives back from a later payout: their net share if they were already paid for it, else 0. */
  clawbackCents: number;
  reason: string;
  method: RefundMethod;
  status: RefundStatus;
  providerRef?: string;
  failure?: string;
  createdById: string;
  createdAt: string;
  settledAt?: string;
  deductedPayoutId?: string;
}

/** FR-14: a customer asks a maker for something made to measure; the maker quotes or declines. */
export interface CustomRequest {
  id: string;
  customerId: string;
  customerName: string;
  shopId: string;
  message: string;
  budgetCents?: number;
  status: CustomRequestStatus;
  quote?: { priceCents: number; days: number; message?: string; quotedAt: string };
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** FR-19: one "helpful" vote per person per review or question. */
export interface HelpfulVote {
  userId: string;
  targetType: "REVIEW" | "QUESTION";
  targetId: string;
  createdAt: string;
}

/** One posting attempt, kept so rate limits (SEC-A6) survive restarts. */
export interface RateEvent {
  userId: string;
  kind: string;
  at: string;
}

/** B09 (backend plan 11.1): a photo someone uploaded. Its id is the photo id that products and shops store. */
export interface Upload {
  id: string;
  ownerId: string;
  storageKey: string;
  purpose: UploadPurpose;
  contentType: string;
  sizeBytes: number;
  status: UploadStatus;
  rejectReason?: string;
  width?: number;
  height?: number;
  createdAt: string;
  confirmedAt?: string;
  processedAt?: string;
}
