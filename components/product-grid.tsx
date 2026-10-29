"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";
import { ProductCard } from "./product-card";

const sizeOrder = (a: string, b: string) => parseFloat(a.replace(",", ".")) - parseFloat(b.replace(",", ".")) || a.localeCompare(b);

/** Сітка товарів із фільтром за розміром: показує лише моделі, які є в обраному розмірі. */
export function ProductGrid({ products }: { products: Product[] }) {
  const [size, setSize] = useState<string | null>(null);
  const sizes = [...new Set(products.flatMap((p) => p.variants.map((v) => v.size)).filter(Boolean))].sort(sizeOrder);
  const list = size ? products.filter((p) => p.variants.some((v) => v.size === size)) : products;

  return (
    <>
      {sizes.length > 1 && (
        <div className="size-filter">
          <span className="muted small">Розмір:</span>
          <div className="chips">
            <button type="button" className={size ? "chip" : "chip chip-active"} onClick={() => setSize(null)}>
              Усі
            </button>
            {sizes.map((s) => (
              <button key={s} type="button" className={s === size ? "chip chip-active" : "chip"} onClick={() => setSize(s === size ? null : s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid">
        {list.map((p, i) => (
          <ProductCard key={p.id} product={p} priority={i < 4} />
        ))}
      </div>
    </>
  );
}
