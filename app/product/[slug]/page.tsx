import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalog, getProduct } from "@/lib/catalog";
import { ProductBuy } from "@/components/product-buy";
import { Gallery } from "@/components/gallery";
import { Benefits } from "@/components/benefits";
import { ProductCard } from "@/components/product-card";
import { formatPrice } from "@/lib/format";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const { products } = await getCatalog();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return {};
  const description = product.description.split("\n")[0].slice(0, 160);
  return {
    title: product.name,
    description,
    openGraph: { title: product.name, description, images: product.images.filter((i) => i.startsWith("http")).slice(0, 1) },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();
  const { products, categories } = await getCatalog();
  const category = categories.find((c) => c.id === product.categoryId);
  const related = products.filter((p) => p.id !== product.id && p.categoryId === product.categoryId).slice(0, 4);
  const more = related.length ? related : products.filter((p) => p.id !== product.id).slice(0, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.images,
    description: product.description,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "UAH",
      lowPrice: product.price,
      availability: product.variants.some((v) => v.inStock) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <section className="container product">
        <nav className="crumbs">
          <Link href="/catalog">Каталог</Link>
          {category && (
            <>
              <span>/</span>
              <Link href={`/catalog/${category.slug}`}>{category.name}</Link>
            </>
          )}
        </nav>
        <div className="product-grid">
          <Gallery images={product.images} name={product.name} />
          <div className="product-info">
            <h1>{product.name}</h1>
            <p className="product-price">
              <strong>{formatPrice(product.price)}</strong>
              {product.oldPrice && <s>{formatPrice(product.oldPrice)}</s>}
            </p>
            <ProductBuy product={product} />
            <Benefits compact />
            {product.description && (
              <div className="description">
                {product.description.split("\n").map((line, i) => (line.trim() ? <p key={i}>{line}</p> : null))}
              </div>
            )}
          </div>
        </div>
      </section>
      {more.length > 0 && (
        <section className="container section">
          <h2>Вам може сподобатись</h2>
          <div className="grid">
            {more.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </>
  );
}
