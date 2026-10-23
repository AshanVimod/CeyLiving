// Values the spec says must come from config, never hard-coded in components (CS-17).

export const SHIPPING_FEE_PER_SHOP_CENTS = 45000;
export const FREE_SHIPPING_THRESHOLD_CENTS = 1500000;
export const COMMISSION_RATE_BPS = 1000;
export const PAGE_SIZE = 12;
export const MAX_CART_QUANTITY = 20;

export const PRICE_CHIPS = [
  { label: "Under LKR 2,500", minPrice: undefined, maxPrice: 250000 },
  { label: "LKR 2,500 to 5,000", minPrice: 250000, maxPrice: 500000 },
  { label: "Over LKR 5,000", minPrice: 500000, maxPrice: undefined },
] as const;

export const SEARCH_SUGGESTION_LIMIT = 8;
export const SEARCH_DEBOUNCE_MS = 250;

// ---------- Accounts, selling and moderation (feature spec sections 9 and 11) ----------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** RULE-A1: wait before a rejected applicant may apply again. */
export const REAPPLY_WAIT_DAYS = 30;
/** RULE-P2: approved items a shop needs before new items publish without review. */
export const APPROVED_ITEMS_FOR_AUTOPUBLISH = 3;
/** RULE-R2: days a review stays editable. */
export const REVIEW_EDIT_DAYS = 30;
/** RULE-M4: open reports that hide content until an admin decides. */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;
/** RULE-M3: mute lengths offered to admins. */
export const MUTE_DAY_OPTIONS = [7, 30] as const;
/** BR-19 / SEC-A10: days after completion a seller can still see the buyer's address. */
export const BUYER_DATA_VISIBLE_DAYS = 30;

/** SEC-A6: posting limits per user, checked in the service layer. */
export const RATE_LIMITS = {
  question: { max: 5, windowMs: HOUR_MS },
  answer: { max: 30, windowMs: HOUR_MS },
  review: { max: 5, windowMs: HOUR_MS },
  reply: { max: 30, windowMs: HOUR_MS },
  report: { max: 10, windowMs: HOUR_MS },
  application: { max: 3, windowMs: DAY_MS },
  customRequest: { max: 5, windowMs: DAY_MS },
  vote: { max: 60, windowMs: HOUR_MS },
} as const;

export const TEXT_LIMITS = {
  questionMin: 10,
  questionMax: 500,
  answerMax: 1000,
  reviewMin: 10,
  reviewMax: 1000,
  replyMax: 1000,
  reasonMin: 10,
  reasonMax: 500,
  storyMin: 50,
  storyMax: 1000,
  reportDetailsMax: 500,
} as const;

/** RULE-P1 / RULE-P3 */
export const PRODUCT_LIMITS = {
  titleMin: 5,
  titleMax: 120,
  descriptionMin: 50,
  descriptionMax: 4000,
  maxImages: 8,
  maxVariants: 10,
  maxCustomFields: 5,
  customFieldMaxLength: 200,
  priceMinCents: 100,
  priceMaxCents: 10_000_000,
  stockMax: 9_999,
  processingDaysMax: 90,
} as const;

/** RULE-S2 */
export const SHOP_SLUG = {
  min: 3,
  max: 60,
  reserved: ["admin", "seller", "account", "api", "new", "sell", "shop"],
} as const;

/** BR-11: earnings become payable this many days after delivery. */
export const PAYOUT_HOLD_DAYS = 7;
/** FR-14: open requests and unanswered quotes expire after this many days. */
export const CUSTOM_REQUEST_EXPIRY_DAYS = 14;

export const DEMO_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const MS = { hour: HOUR_MS, day: DAY_MS } as const;
