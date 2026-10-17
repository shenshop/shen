import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalog, productsInCategory } from "@/lib/catalog";
import { idFromSlug } from "@/lib/slug";
import { ProductCard } from "@/components/product-card";
import { CategoryChips } from "@/components/category-chips";

export const revalidate = 300;

type Props = { params: Promise<{ category: string }> };

export async function generateStaticParams() {
  const { categories } = await getCatalog();
  return categories.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const { categories } = await getCatalog();
  const found = categories.find((c) => c.id === idFromSlug(category));
  return { title: found?.name ?? "Каталог" };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const { products, categories } = await getCatalog();
  const current = categories.find((c) => c.id === idFromSlug(category));
  if (!current) notFound();
  const list = productsInCategory(products, categories, current.id);

  return (
    <section className="container section">
      <h1 className="page-title">{current.name}</h1>
      <CategoryChips categories={categories} active={current.id} />
      {list.length ? (
        <div className="grid">
          {list.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      ) : (
        <p className="muted">У цій категорії поки немає товарів.</p>
      )}
    </section>
  );
}
