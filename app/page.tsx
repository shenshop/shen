import type { Metadata } from "next";
import Link from "next/link";
import { HeroSlider } from "@/components/hero-slider";
import { getCatalog, getFeatured } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { Benefits } from "@/components/benefits";
import { reviews } from "@/data/reviews";


export const metadata: Metadata = { alternates: { canonical: "/" } };

export const revalidate = 3600;


export default async function Home() {
  const [featured, { categories }] = await Promise.all([getFeatured(), getCatalog()]);
  // Перші 5 хітів гортаються в шапці.
  const heroSlides = featured
    .filter((p) => p.images[0])
    .slice(0, 5)
    .map((p) => ({ slug: p.slug, name: p.name, image: p.images[0], price: p.price }));
  const subcategories = categories.filter((c) => c.parentId != null).slice(0, 6);

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-text">
            <p className="eyebrow">Натуральна шкіра · Оплата при отриманні</p>
            <h1>Взуття, яке хочеться носити щодня</h1>
            <p className="lead">Зручні моделі з натуральної шкіри. Приміряйте на пошті, і якщо розмір не підійде, обміняємо протягом 14 днів.</p>
            <div className="hero-actions">
              <Link href="#hity" className="btn btn-dark">
                Обрати модель
              </Link>
              <Link href="/catalog" className="btn btn-light">
                Весь каталог
              </Link>
            </div>
          </div>
          {heroSlides.length > 0 && <HeroSlider slides={heroSlides} />}
        </div>
      </section>

      <section className="container section">
        <Benefits />
      </section>

      <section className="container section" id="hity">
        <div className="section-head">
          <h2>Хіти сезону</h2>
          <Link href="/catalog" className="link">
            Дивитись усі
          </Link>
        </div>
        <div className="grid">
          {featured.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 2} />
          ))}
        </div>
      </section>

      {subcategories.length > 0 && (
        <section className="container section">
          <h2>Категорії</h2>
          <div className="chips">
            {subcategories.map((c) => (
              <Link key={c.id} href={`/catalog/${c.slug}`} className="chip">
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="container section" id="vidguky">
        <h2>Відгуки покупців</h2>
        <p className="muted reviews-note">Повідомлення, які клієнти надіслали нам в Instagram і Viber після отримання взуття.</p>
        <div className="reviews">
          {reviews.map((r, i) => (
            <figure key={i} className="review">
              <blockquote>{r.text}</blockquote>
              <figcaption>
                {r.who} · {r.where}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
