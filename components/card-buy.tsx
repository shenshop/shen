"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "./cart";
import { track } from "./analytics";
import { QuickOrder } from "./product-buy";
import type { Product } from "@/lib/types";
import { colorsOf, itemName } from "@/lib/variants";
import { ColorPicker } from "./color-picker";

// Розміри та кнопки покупки прямо в картці каталогу, без переходу на сторінку товару.
export function CardBuy({ product }: { product: Product }) {
  const { add } = useCart();
  const router = useRouter();
  const [variantId, setVariantId] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [quick, setQuick] = useState(false);
  const colors = colorsOf(product);
  const [color, setColor] = useState(colors[0] ?? "");
  const shown = colors.length ? product.variants.filter((v) => v.color === color) : product.variants;
  const variant = product.variants.find((v) => v.id === variantId) ?? null;

  const buy = () => {
    if (!variant) return setError(true);
    add({ productId: product.id, variantId: variant.id, sku: variant.sku, name: itemName(product, variant), size: variant.size, price: variant.price, image: product.images[0] });
    track("AddToCart", { content_ids: [variant.sku], content_type: "product", value: variant.price, currency: "UAH" });
    router.push("/checkout");
  };

  return (
    <div className="card-buy">
      <ColorPicker
        colors={colors}
        value={color}
        onChange={(c) => {
          setColor(c);
          setVariantId(null);
        }}
      />
      <div className={error ? "card-sizes sizes-error" : "card-sizes"}>
        {shown.map((v) => (
          <button
            key={v.id}
            className={v.id === variantId ? "card-size size-active" : "card-size"}
            disabled={!v.inStock}
            onClick={() => {
              setVariantId(v.id);
              setError(false);
            }}
          >
            {v.size}
          </button>
        ))}
      </div>
      {error && <p className="error-text small">Оберіть розмір</p>}
      <button className="btn btn-dark btn-block card-btn" onClick={buy}>
        Купити
      </button>
      <button
        className="btn btn-light btn-block card-btn"
        onClick={() => (variant ? setQuick(true) : setError(true))}
      >
        Швидке замовлення
      </button>
      {quick && variant && <QuickOrder product={product} variant={variant} onClose={() => setQuick(false)} />}
    </div>
  );
}
