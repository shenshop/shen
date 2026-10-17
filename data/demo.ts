import type { Category, Product } from "@/lib/types";
import { productSlug } from "@/lib/slug";

// Демо-каталог: показується, поки не підключено KeyCRM (немає KEYCRM_API_KEY).
export const demoCategories: Category[] = [
  { id: 1, name: "Жіноче взуття", slug: "1-zhinoche-vzuttia", parentId: null },
  { id: 2, name: "Чоловіче взуття", slug: "2-choloviche-vzuttia", parentId: null },
  { id: 11, name: "Черевики зимові", slug: "11-cherevyky-zymovi", parentId: 1 },
  { id: 12, name: "Кросівки", slug: "12-krosivky", parentId: 1 },
  { id: 13, name: "Балетки та мокасини", slug: "13-baletky-ta-mokasyny", parentId: 1 },
  { id: 21, name: "Черевики", slug: "21-cherevyky", parentId: 2 },
  { id: 22, name: "Кросівки", slug: "22-krosivky", parentId: 2 },
  { id: 23, name: "Мокасини", slug: "23-mokasyny", parentId: 2 },
];

const sizes = (from: number, to: number, price: number, sku: string, out: number[] = []) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const size = from + i;
    return { id: Number(`${sku.replace(/\D/g, "")}${size}`), sku: `${sku}-${size}`, size: String(size), price, inStock: !out.includes(size) };
  });

const raw: Omit<Product, "slug">[] = [
  {
    id: 101,
    name: "Черевики зимові шкіряні на хутрі",
    description:
      "Натуральна шкіра та натуральне хутро всередині. Тримають тепло до -20°C, не промокають у сльоту. Стійка підошва, яка не ковзає.\n\nМатеріал: натуральна шкіра\nУтеплювач: натуральне хутро\nСезон: зима",
    price: 2650,
    oldPrice: 3200,
    images: ["/demo/boots-black-1.svg", "/demo/boots-black-2.svg", "/demo/boots-black-3.svg"],
    categoryId: 11,
    variants: sizes(36, 41, 2650, "W101", [41]),
  },
  {
    id: 102,
    name: "Черевики жіночі коньячні",
    description: "Класичні черевики з гладкої шкіри коньячного кольору. Пасують і до джинсів, і до сукні.\n\nМатеріал: натуральна шкіра\nСезон: зима",
    price: 2490,
    oldPrice: null,
    images: ["/demo/boots-brown-1.svg", "/demo/boots-brown-2.svg", "/demo/boots-brown-3.svg"],
    categoryId: 11,
    variants: sizes(36, 41, 2490, "W102"),
  },
  {
    id: 103,
    name: "Кросівки жіночі білі шкіряні",
    description: "Легкі білі кросівки з натуральної шкіри. Мʼяка устілка, зручні на весь день.\n\nМатеріал: натуральна шкіра\nСезон: весна-осінь",
    price: 1950,
    oldPrice: 2400,
    images: ["/demo/sneakers-white-1.svg", "/demo/sneakers-white-2.svg", "/demo/sneakers-white-3.svg"],
    categoryId: 12,
    variants: sizes(36, 41, 1950, "W103", [36]),
  },
  {
    id: 104,
    name: "Мокасини жіночі чорні",
    description: "Мʼякі мокасини з натуральної шкіри на кожен день.\n\nМатеріал: натуральна шкіра\nСезон: весна-літо",
    price: 1700,
    oldPrice: null,
    images: ["/demo/loafers-black-1.svg", "/demo/loafers-black-2.svg", "/demo/loafers-black-3.svg"],
    categoryId: 13,
    variants: sizes(36, 40, 1700, "W104"),
  },
  {
    id: 201,
    name: "Кросівки чоловічі бежеві",
    description: "Шкіряні кросівки спокійного бежевого кольору. Легкі, з гнучкою підошвою.\n\nМатеріал: натуральна шкіра\nСезон: весна-осінь",
    price: 2200,
    oldPrice: 2600,
    images: ["/demo/sneakers-beige-1.svg", "/demo/sneakers-beige-2.svg", "/demo/sneakers-beige-3.svg"],
    categoryId: 22,
    variants: sizes(40, 45, 2200, "M201"),
  },
  {
    id: 202,
    name: "Мокасини чоловічі коньячні",
    description: "Класичні мокасини ручної роботи з натуральної шкіри.\n\nМатеріал: натуральна шкіра\nСезон: весна-літо",
    price: 1900,
    oldPrice: null,
    images: ["/demo/loafers-cognac-1.svg", "/demo/loafers-cognac-2.svg", "/demo/loafers-cognac-3.svg"],
    categoryId: 23,
    variants: sizes(40, 45, 1900, "M202", [45]),
  },
];

export const demoProducts: Product[] = raw.map((p) => ({ ...p, slug: productSlug(p.id, p.name) }));
