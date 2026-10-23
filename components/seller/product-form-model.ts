import type { Material, Product, Style } from "@/lib/types";

// FR-2c item editor state: the rows a seller edits, and how a saved product turns into them.

export interface Row<T> {
  key: number;
  value: T;
}
export type ImageRow = { url: string; alt: string };
export type VariantRow = { label: string; price: string; compareAt: string; stock: string };
export type CustomRow = {
  label: string;
  kind: "TEXT" | "SELECT";
  options: string;
  maxLength: string;
  isRequired: boolean;
  helper: string;
};

let nextKey = 1;
export const rows = <T>(values: T[]): Row<T>[] => values.map((value) => ({ key: nextKey++, value }));

export function toInitial(p?: Product) {
  const rupees = (c?: number) => (c === undefined ? "" : String(c / 100));
  return {
    title: p?.title ?? "",
    categorySlug: p?.categorySlug ?? "",
    subcategory: p?.subcategory ?? "",
    description: p?.description ?? "",
    materials: p?.materials ?? ([] as Material[]),
    materialNote: p?.materialNote ?? "",
    styles: p?.styles ?? ([] as Style[]),
    tags: p?.tags.join(", ") ?? "",
    type: p?.type ?? "READY_TO_SHIP",
    processingDays: p?.processingDays ? String(p.processingDays) : "",
    dimensions: p?.dimensions ?? "",
    care: p?.care ?? "",
    isHeritage: p?.isHeritage ?? false,
    isEcoFriendly: p?.isEcoFriendly ?? false,
    images: rows<ImageRow>(
      p?.images.map((i) => ({ url: `https://images.unsplash.com/photo-${i.id}`, alt: i.alt })) ?? [
        { url: "", alt: "" },
      ],
    ),
    variants: rows<VariantRow>(
      p?.variants.map((v) => ({
        label: v.label,
        price: rupees(v.priceCents),
        compareAt: rupees(v.compareAtPriceCents),
        stock: String(v.stock),
      })) ?? [{ label: "One size", price: "", compareAt: "", stock: "1" }],
    ),
    customization: rows<CustomRow>(
      p?.customization?.map((f) => ({
        label: f.label,
        kind: f.kind,
        options: f.options?.join(", ") ?? "",
        maxLength: String(f.maxLength),
        isRequired: f.isRequired,
        helper: f.helper ?? "",
      })) ?? [],
    ),
  };
}
