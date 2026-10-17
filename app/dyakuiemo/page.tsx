import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Дякуємо за замовлення", robots: { index: false } };

type Props = { searchParams: Promise<{ order?: string; quick?: string }> };

export default async function ThanksPage({ searchParams }: Props) {
  const { order, quick } = await searchParams;
  return (
    <section className="container section thanks">
      <div className="thanks-mark">✓</div>
      <h1>Дякуємо за замовлення!</h1>
      {order && <p className="lead">Номер замовлення: {order}</p>}
      <p className="muted">
        {quick
          ? "Ми передзвонимо найближчим часом, щоб уточнити доставку."
          : "Менеджер звʼяжеться з вами для підтвердження, а номер ТТН прийде в SMS після відправки."}
      </p>
      <Link href="/catalog" className="btn btn-light">
        Повернутися до каталогу
      </Link>
    </section>
  );
}
