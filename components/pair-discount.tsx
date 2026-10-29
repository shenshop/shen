"use client";

import { settings } from "@/data/settings";
import { formatPrice } from "@/lib/format";
import { useCart } from "./cart";

/** Рядок знижки в корзині та на оформленні; з однією парою підказує про знижку на другу. */
export function PairDiscount() {
  const { count, discount } = useCart();
  if (!settings.secondPairDiscount || count === 0) return null;
  if (discount) {
    return (
      <div className="cart-discount">
        <span>Знижка за другу пару</span>
        <strong>−{formatPrice(discount)}</strong>
      </div>
    );
  }
  return <p className="cart-discount-hint">Додайте другу пару і отримайте знижку {formatPrice(settings.secondPairDiscount)}</p>;
}
