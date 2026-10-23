import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { ProductGrid } from "@/components/product-grid";
import { CategoryChips } from "@/components/category-chips";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Каталог взуття з натуральної шкіри",
  description: "Жіночі та чоловічі черевики, кросівки й туфлі з натуральної шкіри. Доставка по Україні, оплата при отриманні, обмін 14 днів.",
  alternates: { canonical: "/catalog" },
};

export default async function CatalogPage() {
  const { products, categories } = await getCatalog();
  return (
    <section className="container section">
      <h1 className="page-title">Каталог</h1>
      <CategoryChips categories={categories} />
      <ProductGrid products={products} />
    </section>
  );
}
