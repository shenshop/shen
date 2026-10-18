import type { Product, Variant } from "./types";

/** Кольори моделі в порядку появи; порожньо, якщо колір один або не вказаний. */
export function colorsOf(product: Product): string[] {
  const colors = [...new Set(product.variants.map((v) => v.color).filter((c): c is string => Boolean(c)))];
  return colors.length > 1 ? colors : [];
}

/** Назва для корзини й замовлення: з кольором, якщо модель має кілька кольорів. */
export function itemName(product: Product, variant: Variant): string {
  return colorsOf(product).length && variant.color ? `${product.name}, ${variant.color}` : product.name;
}
