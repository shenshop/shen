import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { CategoryChips } from "@/components/category-chips";

export const revalidate = 900;
export const metadata: Metadata = { title: "Каталог" };

export default async function CatalogPage() {
  const { products, categories } = await getCatalog();
  return (
    <section className="container section">
      <h1 className="page-title">Каталог</h1>
      <CategoryChips categories={categories} />
      <div className="grid">
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} priority={i < 4} />
        ))}
      </div>
    </section>
  );
}
