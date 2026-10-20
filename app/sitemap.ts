import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/catalog";
import { siteUrl } from "@/lib/seo";

export const revalidate = 3600;

// Карта сайту для Google: головна, каталог, категорії та всі товари.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories } = await getCatalog();
  return [
    { url: siteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: siteUrl("/catalog"), changeFrequency: "daily", priority: 0.9 },
    ...categories.map((c) => ({ url: siteUrl(`/catalog/${c.slug}`), changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.map((p) => ({
      url: siteUrl(`/product/${p.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
      images: p.images.filter((i) => i.startsWith("http")).slice(0, 3),
    })),
  ];
}
