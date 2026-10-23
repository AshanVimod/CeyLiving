import "server-only";
import { SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { productSeeds, type ProductSeed } from "@/lib/data/products";
import { shopSeeds } from "@/lib/data/shops";
import type { Order, OrderItem, Product, Review, SellerOrder, SellerOrderStatus, Shop, User } from "@/lib/types";
import type { StoreData } from "./dev-store";

/** Fixed time for the read-only production seed, so builds are reproducible. */
export const SEED_TIME = "2026-10-22T06:00:00.000Z";

/** The six accounts offered on /signin in development (feature spec 7.5). */
export const DEMO_ACCOUNTS = [
  { id: "user_customer", label: "Customer", note: "Has orders, one ready to review" },
  { id: "user_applicant", label: "Applicant", note: "Seller application pending" },
  { id: "user_seller", label: "Seller", note: "Ambalangoda Mask House, active" },
  { id: "user_seller_suspended", label: "Seller (suspended)", note: "Pol Katu Lanka, suspended" },
  { id: "user_admin", label: "Admin", note: "Reviews applications and content" },
  { id: "user_muted", label: "Muted customer", note: "Can buy, can't post for 7 days" },
] as const;

const SHOP_OWNERS: Record<string, string> = {
  "ambalangoda-mask-house": "user_seller",
  "pol-katu-lanka": "user_seller_suspended",
};

const ADDRESS = {
  recipientName: "Anushka Perera",
  line1: "24 Temple Road",
  city: "Nugegoda",
  district: "Colombo",
  postalCode: "10250",
  phone: "0771234567",
};

const iso = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000).toISOString();
const slugId = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

function seedUsers(now: Date): User[] {
  const base = { emailVerified: true, postingRestriction: "NONE" as const, createdAt: iso(now, -400) };
  return [
    {
      ...base,
      id: "user_customer",
      name: "Anushka Perera",
      email: "anushka@example.lk",
      phone: "0771234567",
      role: "CUSTOMER",
    },
    {
      ...base,
      id: "user_applicant",
      name: "Tharindu Silva",
      email: "tharindu@example.lk",
      phone: "0712345678",
      role: "CUSTOMER",
      createdAt: iso(now, -40),
    },
    {
      ...base,
      id: "user_seller",
      name: "Ruwan Wijesuriya",
      email: "ruwan@example.lk",
      phone: "0779876543",
      role: "SELLER",
    },
    { ...base, id: "user_seller_suspended", name: "Chaminda Silva", email: "chaminda@example.lk", role: "SELLER" },
    { ...base, id: "user_admin", name: "Dilani Fernando", email: "dilani@ceyliving.example", role: "ADMIN" },
    {
      ...base,
      id: "user_muted",
      name: "Nuwan Jayasinghe",
      email: "nuwan@example.lk",
      role: "CUSTOMER",
      postingRestriction: "MUTED",
      mutedUntil: iso(now, 7),
      restrictionReason: "Posted the same promotional message on many items.",
    },
  ];
}

function seedShops(now: Date): { shops: Shop[]; owners: User[] } {
  const owners: User[] = [];
  const shops = shopSeeds.map((s): Shop => {
    let ownerId = SHOP_OWNERS[s.slug];
    if (!ownerId) {
      ownerId = `user_owner_${slugId(s.slug)}`;
      owners.push({
        id: ownerId,
        name: s.ownerName,
        email: `${slugId(s.ownerName).replace(/-/g, ".")}@example.lk`,
        role: "SELLER",
        emailVerified: true,
        postingRestriction: "NONE",
        createdAt: iso(now, -300),
      });
    }
    const suspended = s.slug === "pol-katu-lanka";
    return {
      ...s,
      id: `shop_${slugId(s.slug)}`,
      ownerId,
      status: suspended ? "SUSPENDED" : "ACTIVE",
      statusReason: suspended ? "Listings used photos that belong to another maker. Under review." : undefined,
      payoutAccountMasked: "•••• 4821",
      createdAt: iso(now, -300),
      updatedAt: iso(now, -30),
    };
  });
  return { shops, owners };
}

function toProduct(seed: ProductSeed, now: Date): Product {
  const { reviews, ...rest } = seed;
  void reviews;
  return {
    ...rest,
    id: `prod_${slugId(seed.slug)}`,
    status: "ACTIVE",
    createdAt: rest.publishedAt + "T08:00:00.000Z",
    updatedAt: iso(now, -5),
  };
}

interface OrderSpec {
  number: number;
  customerId: string;
  product: Product;
  shop: Shop;
  status: SellerOrderStatus;
  placedAt: string;
  completedAt?: string;
}

function buildOrder(spec: OrderSpec) {
  const variant = spec.product.variants[0]!;
  const n = String(spec.number).padStart(6, "0");
  const order: Order = {
    id: `order_${n}`,
    orderNumber: `CM-2026-${n}`,
    customerId: spec.customerId,
    shippingAddress: ADDRESS,
    subtotalCents: variant.priceCents,
    shippingCents: SHIPPING_FEE_PER_SHOP_CENTS,
    totalCents: variant.priceCents + SHIPPING_FEE_PER_SHOP_CENTS,
    placedAt: spec.placedAt,
  };
  const sellerOrder: SellerOrder = {
    id: `so_${n}`,
    orderId: order.id,
    shopId: spec.shop.id,
    status: spec.status,
    subtotalCents: variant.priceCents,
    shippingCents: SHIPPING_FEE_PER_SHOP_CENTS,
    acceptedAt: spec.status === "NEW" ? undefined : spec.placedAt,
    courierName: ["DISPATCHED", "COMPLETED"].includes(spec.status) ? "Pronto Lanka" : undefined,
    trackingRef: ["DISPATCHED", "COMPLETED"].includes(spec.status) ? `PL${n}` : undefined,
    dispatchedAt: ["DISPATCHED", "COMPLETED"].includes(spec.status) ? spec.placedAt : undefined,
    completedAt: spec.completedAt,
    updatedAt: spec.completedAt ?? spec.placedAt,
  };
  const item: OrderItem = {
    id: `item_${n}`,
    sellerOrderId: sellerOrder.id,
    productId: spec.product.id,
    variantSku: variant.sku,
    productTitle: spec.product.title,
    variantLabel: variant.label,
    unitPriceCents: variant.priceCents,
    quantity: 1,
  };
  return { order, sellerOrder, item };
}

export function buildSeed(now: Date): StoreData {
  const users = seedUsers(now);
  const { shops, owners } = seedShops(now);
  const products = productSeeds.map((p) => toProduct(p, now));
  const data: StoreData = {
    version: 2,
    users: [...users, ...owners],
    applications: [],
    shops,
    products,
    orders: [],
    sellerOrders: [],
    orderItems: [],
    reviews: [],
    questions: [],
    answers: [],
    reports: [],
    auditLog: [],
    notifications: [],
    addresses: [{ id: "addr_home", userId: "user_customer", label: "Home", ...ADDRESS }],
    rateEvents: [],
    payouts: [],
    customRequests: [],
    helpfulVotes: [],
  };
  const shopBySlug = (slug: string) => shops.find((s) => s.slug === slug)!;
  const productBySlug = (slug: string) => products.find((p) => p.slug === slug)!;
  let orderNumber = 100;
  const addOrder = (spec: Omit<OrderSpec, "number">) => {
    const built = buildOrder({ ...spec, number: ++orderNumber });
    data.orders.push(built.order);
    data.sellerOrders.push(built.sellerOrder);
    data.orderItems.push(built.item);
    return built.item;
  };

  seedReviews(data, now, productBySlug, shopBySlug, addOrder);
  seedCustomerOrders(now, productBySlug, shopBySlug, addOrder);
  seedApplicationAndContent(data, now, productBySlug);
  return data;
}

type AddOrder = (spec: Omit<OrderSpec, "number">) => OrderItem;

/** Each existing review becomes a verified review on a completed demo order (fixes D-06). */
function seedReviews(
  data: StoreData,
  now: Date,
  productBySlug: (s: string) => Product,
  shopBySlug: (s: string) => Shop,
  addOrder: AddOrder,
) {
  const reviewerIds = new Map<string, string>([["Anushka P.", "user_customer"]]);
  productSeeds.forEach((seed) => {
    seed.reviews.forEach((r) => {
      let authorId = reviewerIds.get(r.customerName);
      if (!authorId) {
        authorId = `user_reviewer_${reviewerIds.size}`;
        reviewerIds.set(r.customerName, authorId);
        data.users.push({
          id: authorId,
          name: r.customerName,
          email: `${authorId}@example.lk`,
          role: "CUSTOMER",
          emailVerified: true,
          postingRestriction: "NONE",
          createdAt: iso(now, -200),
        });
      }
      const product = productBySlug(seed.slug);
      const shop = shopBySlug(seed.shopSlug);
      const reviewedAt = `${r.date}T10:00:00.000Z`;
      const item = addOrder({
        customerId: authorId,
        product,
        shop,
        status: "COMPLETED",
        placedAt: iso(new Date(reviewedAt), -10),
        completedAt: iso(new Date(reviewedAt), -2),
      });
      const review: Review = {
        id: `review_${item.id}`,
        productId: product.id,
        shopId: shop.id,
        orderItemId: item.id,
        authorId,
        authorName: r.customerName,
        rating: r.rating,
        comment: r.comment,
        status: "VISIBLE",
        createdAt: reviewedAt,
      };
      data.reviews.push(review);
    });
  });
}

/** The demo customer's own orders: one delivered and unreviewed, one on its way, one new for the demo seller. */
function seedCustomerOrders(
  now: Date,
  productBySlug: (s: string) => Product,
  shopBySlug: (s: string) => Shop,
  addOrder: AddOrder,
) {
  addOrder({
    customerId: "user_customer",
    product: productBySlug("macrame-plant-hanger"),
    shop: shopBySlug("nool-and-knot"),
    status: "COMPLETED",
    placedAt: iso(now, -12),
    completedAt: iso(now, -5),
  });
  addOrder({
    customerId: "user_customer",
    product: productBySlug("mayura-raksha-wall-mask"),
    shop: shopBySlug("ambalangoda-mask-house"),
    status: "DISPATCHED",
    placedAt: iso(now, -4),
  });
  addOrder({
    customerId: "user_customer",
    product: productBySlug("carved-elephant-family"),
    shop: shopBySlug("ambalangoda-mask-house"),
    status: "NEW",
    placedAt: iso(now, -1),
  });
}

function seedApplicationAndContent(data: StoreData, now: Date, productBySlug: (s: string) => Product) {
  data.applications.push({
    id: "app_tharindu",
    userId: "user_applicant",
    shopName: "Matale Laksha Works",
    craft: "Laksha lacquerware turned on a hand lathe",
    categorySlug: "sri-lankan-handicrafts",
    district: "Matale",
    story:
      "My family has turned and lacquered wood in Matale for three generations. I make bowls, boxes and walking sticks with the traditional red, yellow and black bands, using lac and natural pigments.",
    phone: "0712345678",
    workPhotoUrls: [
      "https://images.unsplash.com/photo-1786468539104-e03f3ae580ea",
      "https://images.unsplash.com/photo-1759523121247-76be6b3490b2",
      "https://images.unsplash.com/photo-1788296817269-8df0458ab799",
    ],
    acceptedTermsAt: iso(now, -3),
    status: "PENDING",
    createdAt: iso(now, -3),
    updatedAt: iso(now, -3),
  });

  const naga = productBySlug("naga-raksha-mask");
  const gurulu = productBySlug("gurulu-raksha-mask");
  data.questions.push(
    {
      id: "q_naga_size",
      productId: naga.id,
      shopId: "shop_ambalangoda-mask-house",
      authorId: "user_customer",
      authorName: "Anushka Perera",
      body: "Is the large mask heavy enough to need two hooks on a plaster wall?",
      status: "VISIBLE",
      createdAt: iso(now, -6),
    },
    {
      id: "q_gurulu_colour",
      productId: gurulu.id,
      shopId: "shop_ambalangoda-mask-house",
      authorId: "user_reviewer_1",
      authorName: "Tom H.",
      body: "Are the blue wings painted or made from real feathers?",
      status: "VISIBLE",
      createdAt: iso(now, -2),
    },
  );
  data.answers.push({
    id: "a_naga_size",
    questionId: "q_naga_size",
    authorId: "user_seller",
    authorRole: "SELLER",
    body: "One strong hook is enough. The large mask weighs about 1.2 kg and has a fixed hanging loop on the back.",
    status: "VISIBLE",
    createdAt: iso(now, -5),
  });
  data.notifications.push({
    id: "notif_seed_shipped",
    userId: "user_customer",
    type: "order.dispatched",
    title: "Your Mayura Raksha wall mask is on its way",
    href: `/account/orders/${data.orders.at(-2)?.orderNumber ?? ""}`,
    createdAt: iso(now, -3),
  });
}
