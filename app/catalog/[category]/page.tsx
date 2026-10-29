import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCatalog, productsInCategory } from "@/lib/catalog";
import { idFromSlug } from "@/lib/slug";
import { formatPrice } from "@/lib/format";
import { ProductGrid } from "@/components/product-grid";
import { CategoryChips } from "@/components/category-chips";

export const revalidate = 3600;

type Props = { params: Promise<{ category: string }> };

export async function generateStaticParams() {
  const { categories } = await getCatalog();
  return categories.map((c) => ({ category: c.slug }));
}

const models = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "модель" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "моделі" : "моделей";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const { products, categories } = await getCatalog();
  const found = categories.find((c) => c.id === idFromSlug(category));
  if (!found) return { title: "Каталог" };
  const items = productsInCategory(products, categories, found.id);
  const from = items.length ? Math.min(...items.map((p) => p.price)) : null;
  return {
    title: `${found.name} — купити в Україні${from ? `, ціна від ${formatPrice(from)}` : ""}`,
    description: `${found.name} з натуральної шкіри: ${items.length} ${models(items.length)}${from ? ` від ${formatPrice(from)}` : ""}. Доставка Новою Поштою та Укрпоштою, оплата при отриманні, обмін 14 днів.`,
    alternates: { canonical: `/catalog/${found.slug}` },
  };
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
        <ProductGrid products={list} />
      ) : (
        <p className="muted">У цій категорії поки немає товарів.</p>
      )}
    </section>
  );
}
