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

/** Фото кольору: перше фото варіанта цього кольору. */
export function colorImage(product: Product, color: string): string | undefined {
  return product.variants.find((v) => v.color === color && v.image)?.image;
}

/** Колір, обраний спочатку: той, що на головному фото, інакше перший. */
export function defaultColor(product: Product): string {
  const colors = colorsOf(product);
  return colors.find((c) => colorImage(product, c) === product.images[0]) ?? colors[0] ?? "";
}
