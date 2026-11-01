import "server-only";

/**
 * The five accounts offered on /signin in development and on the demo (feature spec 7.5). They exist in the demo
 * data (prisma/seed-data.ts). The muted customer (user_muted) is there for tests and admin moderation, but isn't
 * offered for sign-in.
 */
export const DEMO_ACCOUNTS = [
  { id: "user_customer", label: "Customer", note: "Has orders, one ready to review" },
  { id: "user_applicant", label: "Applicant", note: "Shop application pending" },
  { id: "user_seller", label: "Seller", note: "Ambalangoda Mask House, active" },
  { id: "user_seller_suspended", label: "Seller (suspended)", note: "Pol Katu Lanka, suspended" },
  { id: "user_admin", label: "Admin", note: "Reviews applications and content" },
] as const;
