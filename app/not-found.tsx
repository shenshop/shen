import Link from "next/link";

export default function NotFound() {
  return (
    <section className="container section thanks">
      <h1>Сторінку не знайдено</h1>
      <p className="muted">Можливо, товар уже розпродано.</p>
      <Link href="/catalog" className="btn btn-dark">
        До каталогу
      </Link>
    </section>
  );
}
