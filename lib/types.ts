// Mirrors Section 7 of the build spec and Section 6 of the feature spec, so the API can replace the dev store later.
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
  "NEW" | "ACCEPTED" | "IN_PROGRESS" | "DISPATCHED" | "COMPLETED" | "CANCELLED" | "REFUNDED";
export type ReportStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type PostingRestriction = "NONE" | "MUTED" | "BANNED";
export type ReportTargetType = "PRODUCT" | "SHOP" | "REVIEW" | "QUESTION" | "ANSWER";
export type PayoutStatus = "PENDING" | "SCHEDULED" | "PAID" | "FAILED";
export type CustomRequestStatus = "OPEN" | "QUOTED" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export interface Photo {
  /** Image CDN photo id. */
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

export interface SellerApplication {
  id: string;
  userId: string;
  shopName: string;
  craft: string;
  categorySlug: string;
  district: string;
  story: string;
  phone: string;
  workPhotoUrls: string[];
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
  actorId: string;
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
