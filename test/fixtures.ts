import { applicationSchema } from "@/lib/validation/application";
import { productSchema } from "@/lib/validation/product";
import { shopSchema } from "@/lib/validation/shop";

/** A seed photo id (the seed application has it). Services accept it only where it is already saved (B09). */
const PHOTO = "1786468539104-e03f3ae580ea";

export const validApplication = (overrides: Record<string, unknown> = {}) =>
  applicationSchema.parse({
    applicantName: "Nimali Perera",
    phone: "0771112233",
    businessType: "INDIVIDUAL",
    shopName: "Kelani Clay Studio",
    craft: "Hand-built terracotta planters",
    categorySlugs: ["home-decor", "eco-friendly"],
    address: { line1: "12 Temple Road", city: "Kelaniya", district: "Gampaha", postalCode: "11600" },
    story: "I build planters and lamps by hand from Kelani river clay, fired in a small wood kiln behind our house.",
    workPhotoIds: [PHOTO, "1759523121247-76be6b3490b2", "1788296817269-8df0458ab799"],
    acceptTerms: "on",
    ...overrides,
  });

export const validShop = (overrides: Record<string, unknown> = {}) =>
  shopSchema.parse({
    name: "Matale Laksha Works",
    slug: "matale-laksha-works",
    craft: "Laksha lacquerware",
    district: "Matale",
    story: "My family has turned and lacquered wood in Matale for three generations, using lac and natural pigments.",
    quote: "",
    dispatchDays: "Ships in 3 to 5 days",
    returnPolicy: "Returns accepted within 14 days if unused.",
    logo: { id: PHOTO, alt: "Lacquered bowl" },
    banner: { id: PHOTO, alt: "Workshop shelves" },
    ...overrides,
  });

export const productInput = (overrides: Record<string, unknown> = {}, mode: "draft" | "submit" = "submit") =>
  productSchema(mode).parse({
    title: "Lacquered jewellery box",
    categorySlug: "sri-lankan-handicrafts",
    subcategory: "Lacquerware",
    description: "A small lidded box turned from jak wood and finished with red, yellow and black lac bands.",
    materials: ["wood"],
    materialNote: "Jak wood, lac",
    styles: ["TRADITIONAL"],
    tags: "lacquer, box",
    type: "READY_TO_SHIP",
    dimensions: "10 cm across",
    care: "Wipe with a dry cloth.",
    isHeritage: true,
    isEcoFriendly: false,
    images: [{ id: PHOTO, alt: "Red and yellow lacquered box" }],
    variants: [{ label: "One size", price: "3500", stock: 4 }],
    customization: [],
    ...overrides,
  });
