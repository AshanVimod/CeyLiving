import type { Category } from "../types";

// The 12 launch categories from Section 3.1 of the spec. Slugs are part of the URL contract.
export const categories: Category[] = [
  {
    name: "Wood Carvings",
    slug: "wood-carvings",
    group: "TRADITIONAL",
    blurb: "Raksha masks, carved elephants and ornaments from the southern coast.",
    subcategories: ["Masks", "Sculptures", "Carved ornaments"],
    photo: { id: "1776335907878-83817653ee6b", alt: "Painted wooden Raksha mask with peacock feathers" },
    sinhala: "වෙස් මුහුණු",
  },
  {
    name: "Traditional Art & Paintings",
    slug: "traditional-art",
    group: "TRADITIONAL",
    blurb: "Cultural paintings and heritage artwork by island painters.",
    subcategories: ["Cultural paintings", "Heritage artwork"],
    photo: { id: "1541753866388-0b3c701627d3", alt: "Painter working on a landscape of a tree and a cliff" },
  },
  {
    name: "Handloom, Batik & Lace",
    slug: "handloom-batik-lace",
    group: "TRADITIONAL",
    blurb: "Handloom cotton, wax-resist batik and Beeralu bobbin lace.",
    subcategories: ["Handloom textiles", "Batik", "Beeralu lace"],
    photo: { id: "1745091951967-40a877a20616", alt: "Close-up of a brown lace border" },
    sinhala: "බීරළු",
  },
  {
    name: "Sri Lankan Handicrafts",
    slug: "sri-lankan-handicrafts",
    group: "TRADITIONAL",
    blurb: "Cane and bamboo, coconut shell and Dumbara weaving.",
    subcategories: ["Cane and bamboo", "Coconut shell", "Dumbara weaving"],
    photo: { id: "1768902406144-a348c559c73c", alt: "Hands weaving a cane basket" },
    sinhala: "දුම්බර",
  },
  {
    name: "Wall Art & Décor",
    slug: "wall-art-decor",
    group: "MODERN",
    blurb: "Paintings, textured and minimalist pieces for the wall.",
    subcategories: ["Paintings", "Textured art", "Minimalist décor"],
    photo: { id: "1541961017774-22349e4a1262", alt: "Abstract painting in blue, orange and white" },
  },
  {
    name: "Fashion & Batik Wear",
    slug: "fashion-batik-wear",
    group: "MODERN",
    blurb: "Batik outfits and hand-painted clothing.",
    subcategories: ["Dresses", "Batik outfits", "Hand-painted clothing"],
    photo: { id: "1735553816867-88cd8496df58", alt: "Printed dress on a mannequin by a window" },
    sinhala: "බතික්",
  },
  {
    name: "Jewellery & Accessories",
    slug: "jewellery-accessories",
    group: "MODERN",
    blurb: "Earrings, bracelets and rings, made in small batches.",
    subcategories: ["Earrings", "Bracelets", "Rings"],
    photo: { id: "1766560359809-3a727c487fe6", alt: "Row of colourful woven bracelets" },
  },
  {
    name: "Bags, Wallets & Shoes",
    slug: "bags-wallets-shoes",
    group: "MODERN",
    blurb: "Leather bags and wallets cut and stitched by hand.",
    subcategories: ["Bags", "Wallets", "Sandals"],
    photo: { id: "1600857062241-98e5dba7f214", alt: "Brown leather sling bag" },
  },
  {
    name: "Personalized Gifts",
    slug: "personalized-gifts",
    group: "MODERN",
    blurb: "Portraits, nameplates and engraved gifts made for one person.",
    subcategories: ["Custom portraits", "Nameplates", "Engraved gifts"],
    photo: { id: "1674643925879-d457c6e93801", alt: "Artist drawing a portrait on paper" },
  },
  {
    name: "Home Décor",
    slug: "home-decor",
    group: "MODERN",
    blurb: "Pottery, vases, bowls and objects for the house.",
    subcategories: ["Pottery", "Vases", "Bowls"],
    photo: { id: "1631125915902-d8abe9225ff2", alt: "Three brown clay vases on a concrete table" },
  },
  {
    name: "Eco-Friendly Creations",
    slug: "eco-friendly",
    group: "MODERN",
    blurb: "Upcycled fashion, recycled art and reusable things.",
    subcategories: ["Upcycled fashion", "Recycled art", "Reusable products"],
    photo: { id: "1662219708541-3a74d96330eb", alt: "Upcycled denim with an embroidered flower" },
  },
  {
    name: "Textile & Fiber Art",
    slug: "textile-fiber-art",
    group: "MODERN",
    blurb: "Macramé, embroidery and woven accessories.",
    subcategories: ["Macramé", "Embroidery", "Woven accessories"],
    photo: { id: "1633594308237-3dcfa56b4e69", alt: "Macramé plant hanger on a wall" },
  },
];

export function getCategory(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}
