"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/lib/types";
import { ProductCard } from "./product-card";

const KEY = "shen-size";

const sizeOrder = (a: string, b: string) => parseFloat(a.replace(",", ".")) - parseFloat(b.replace(",", ".")) || a.localeCompare(b);

/** Сітка товарів із фільтром за розміром. Обраний розмір запамʼятовується між сторінками. */
export function ProductGrid({ products }: { products: Product[] }) {
  const [size, setSize] = useState<string | null>(null);
  const sizes = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size)).filter(Boolean))].sort(sizeOrder);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && sizes.includes(saved)) setSize(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (s: string | null) => {
    setSize(s);
    try {
      if (s) localStorage.setItem(KEY, s);
      else localStorage.removeItem(KEY);
    } catch {}
  };

  const list = size ? products.filter((p) => p.variants.some((v) => v.size === size)) : products;

  return (
    <>
      {sizes.length > 1 && (
        <div className="size-filter">
          <span className="size-filter-label">Мій розмір:</span>
          <div className="size-filter-list">
            <button type="button" className={size ? "chip" : "chip chip-active"} onClick={() => choose(null)}>
              Усі
            </button>
            {sizes.map((s) => (
              <button key={s} type="button" className={s === size ? "chip chip-active" : "chip"} onClick={() => choose(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {list.length ? (
        <div className="grid">
          {list.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      ) : (
        <p className="muted">У розмірі {size} тут поки немає моделей.</p>
      )}
    </>
  );
}
