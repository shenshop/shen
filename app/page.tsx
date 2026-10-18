import Link from "next/link";
import Image from "next/image";
import { getCatalog, getFeatured } from "@/lib/catalog";
import { ProductCard } from "@/components/product-card";
import { Benefits } from "@/components/benefits";

export const revalidate = 900;

const reviews = [
  { name: "Олена, Київ", text: "Черевики прийшли за день, шкіра справжня, сидять ідеально. Беру вже другу пару." },
  { name: "Ірина, Львів", text: "Не підійшов розмір, обміняли без питань. Дуже приємний сервіс." },
  { name: "Андрій, Дніпро", text: "Кросівки легкі й зручні, за ці гроші якість чудова." },
];

export default async function Home() {
  const [featured, { categories }] = await Promise.all([getFeatured(), getCatalog()]);
  const hero = featured[0];
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
          {hero && (
            <Link href={`/product/${hero.slug}`} className="hero-image">
              <Image src={hero.images[0]} alt={hero.name} fill priority sizes="(max-width: 800px) 100vw, 50vw" unoptimized={hero.images[0].endsWith(".svg")} />
            </Link>
          )}
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
        <div className="reviews">
          {reviews.map((r) => (
            <figure key={r.name} className="review">
              <div className="stars" aria-label="5 з 5">★★★★★</div>
              <blockquote>{r.text}</blockquote>
              <figcaption>{r.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </>
  );
}
