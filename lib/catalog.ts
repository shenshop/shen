import "server-only";
import { cache } from "react";
import type { Category, Product } from "./types";
import { fetchCatalog, keycrmEnabled } from "./keycrm";
import { demoCategories, demoProducts } from "@/data/demo";
import { idFromSlug } from "./slug";

export const getCatalog = cache(async (): Promise<{ products: Product[]; categories: Category[] }> => {
  if (!keycrmEnabled()) return { products: demoProducts, categories: demoCategories };
  return fetchCatalog();
});

export async function getProduct(slug: string): Promise<Product | null> {
  const id = idFromSlug(slug);
  const { products } = await getCatalog();
  return products.find((p) => p.id === id) ?? null;
}

/** Моделі, які йдуть у рекламу: FEATURED_PRODUCT_IDS=101,103,201 або перші 5 товарів. */
export async function getFeatured(): Promise<Product[]> {
  const { products } = await getCatalog();
  const ids = (process.env.FEATURED_PRODUCT_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  if (ids.length) return ids.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => Boolean(p));
  return products.slice(0, 5);
}

/** Товари категорії разом з усіма її підкатегоріями. */
export function productsInCategory(products: Product[], categories: Category[], categoryId: number): Product[] {
  const ids = new Set([categoryId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of categories) {
      if (c.parentId != null && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        added = true;
      }
    }
  }
  return products.filter((p) => p.categoryId != null && ids.has(p.categoryId));
}
