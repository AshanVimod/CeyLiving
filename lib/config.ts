// Values the spec says must come from config, never hard-coded in components (CS-17).

export const SHIPPING_FEE_PER_SHOP_CENTS = 45000;
export const FREE_SHIPPING_THRESHOLD_CENTS = 1500000;
export const COMMISSION_RATE_BPS = 1000;
export const PAGE_SIZE = 12;
export const MAX_CART_QUANTITY = 20;
/** BR-06: an unpaid order is cancelled and its stock returned this long after checkout. */
export const PAYMENT_WINDOW_MINUTES = 30;
/** BR-08: a maker must accept a paid order within this many days, or it is cancelled (set when the order is paid). */
export const SELLER_ACCEPT_DEADLINE_DAYS = 3;
/** B08: the result page re-reads a pending payment this often, for at most this long (backend plan 9.1 step 7). */
export const PAYMENT_RESULT_POLL = { everyMs: 2_000, forMs: 20_000 } as const;

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
  // Build spec 9.1: checkout is limited to 10 a minute per user.
  checkout: { max: 10, windowMs: 60_000 },
  // B11: revealing bank details: per admin, and failed attempts (a wrong password or a refused role) per person.
  payoutReveal: { max: 60, windowMs: HOUR_MS },
  payoutRevealFailure: { max: 5, windowMs: 15 * 60_000 },
  // B09 (backend plan 11.1): upload addresses, 30 an hour per user.
  upload: { max: 30, windowMs: HOUR_MS },
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
/** SEC-07: what an upload may be. The worker checks the real file against the same limits. */
export const UPLOAD_LIMITS = {
  types: ["image/jpeg", "image/png", "image/webp"] as const,
  maxBytes: 8 * 1024 * 1024,
  /** Shortest and longest side, in pixels. */
  minSide: 300,
  maxSide: 12_000,
  maxPixels: 40_000_000,
  /** Photos of their work an applicant adds (feature spec 4.2). */
  applicationMin: 3,
  applicationMax: 6,
};

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
/** BR-17: a dispatched order the customer hasn't confirmed completes on its own this many days after dispatch. */
export const AUTO_COMPLETE_DAYS = 7;
/** FR-14: open requests and unanswered quotes expire after this many days. */
export const CUSTOM_REQUEST_EXPIRY_DAYS = 14;

export const MS = { hour: HOUR_MS, day: DAY_MS } as const;

// ---------- B12: security events and alerts (backend plan OPS-06, A09) ----------

/** A09: every kind of event that is counted. Counts only: no person, IP or id is ever stored with one. */
export const OPS_EVENT_KINDS = [
  "server_error",
  "job_failed",
  "payment_signature_failed",
  "sign_in_failed",
  "auth_rate_limited",
  "permission_denied",
  "payout_reveal_failed",
  "payout_reveal_locked",
  "payout_revealed",
  "origin_rejected",
  "body_too_large",
] as const;
export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number];

/** Events are counted in buckets this long; the watcher runs this often too. */
export const OPS_BUCKET_MS = 5 * 60_000;

/**
 * OPS-06: when a count becomes an alert. `critical` alerts email every admin and show in the app; `normal` ones only
 * show in the app. The thresholds are starting guesses for a small launch: tune them here.
 */
export const OPS_ALERT_RULES: Record<
  OpsEventKind,
  { label: string; threshold: number; windowMs: number; level: "critical" | "normal" }
> = {
  server_error: { label: "Server errors", threshold: 20, windowMs: 15 * 60_000, level: "critical" },
  job_failed: { label: "Background jobs failed", threshold: 1, windowMs: 15 * 60_000, level: "critical" },
  payment_signature_failed: {
    label: "Payment notifications with a bad signature",
    threshold: 3,
    windowMs: 15 * 60_000,
    level: "critical",
  },
  sign_in_failed: { label: "Failed sign-ins", threshold: 50, windowMs: 15 * 60_000, level: "critical" },
  payout_reveal_failed: {
    label: "Failed attempts to show bank details",
    threshold: 3,
    windowMs: 15 * 60_000,
    level: "critical",
  },
  payout_reveal_locked: {
    label: "Bank details locked after wrong passwords",
    threshold: 1,
    windowMs: 15 * 60_000,
    level: "critical",
  },
  payout_revealed: { label: "Bank details shown unusually often", threshold: 40, windowMs: HOUR_MS, level: "critical" },
  auth_rate_limited: { label: "Sign-in limits reached", threshold: 30, windowMs: 15 * 60_000, level: "normal" },
  permission_denied: {
    label: "Actions refused for lack of permission",
    threshold: 30,
    windowMs: 15 * 60_000,
    level: "normal",
  },
  origin_rejected: {
    label: "Requests from another site refused",
    threshold: 20,
    windowMs: 15 * 60_000,
    level: "normal",
  },
  body_too_large: { label: "Oversized requests refused", threshold: 20, windowMs: 15 * 60_000, level: "normal" },
};

/** OPS-06: live checks, read each time the watcher runs (critical). */
export const OPS_LIMIT_RULES = {
  db_connections: { label: "Database connections nearly used up", percent: 80 },
  db_size: { label: "Database nearly at its size limit", percent: 85 },
  disk: { label: "Disk nearly full", percent: 85 },
  backup: { label: "Backup failed or overdue", overdueMs: 26 * HOUR_MS },
} as const;

/** OPS-06: one alert per kind in this long, unless it gets OPS_ALERT_ESCALATE_FACTOR times worse. */
export const OPS_ALERT_QUIET_MS = HOUR_MS;
export const OPS_ALERT_ESCALATE_FACTOR = 4;
/** Counters older than this are deleted by maintenance.cleanup. */
export const OPS_EVENT_RETENTION_DAYS = 30;
