import "server-only";
import type { Category, OrderRequest, Product, Variant } from "./types";
import { productSlug, slugify } from "./slug";

const BASE = "https://openapi.keycrm.app/v1";
// Година: вкладається в безкоштовний ліміт записів Cloudflare KV. Для миттєвого оновлення є /api/revalidate.
const REVALIDATE_SECONDS = 3600;

export const keycrmEnabled = () => Boolean(process.env.KEYCRM_API_KEY);

async function request<T>(path: string, init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.KEYCRM_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`KeyCRM ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

type Page<T> = { data: T[]; next_page_url?: string | null; last_page?: number; current_page?: number };

/** Забирає всі сторінки списку (KeyCRM віддає максимум 50 записів за раз). */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 40; page++) {
    const res = await request<Page<T>>(`${path}${sep}limit=50&page=${page}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["catalog"] },
    });
    out.push(...res.data);
    if (!res.next_page_url) break;
  }
  return out;
}

type KProduct = {
  id: number;
  name: string;
  description?: string | null;
  thumbnail_url?: string | null;
  attachments_data?: string[] | null;
  min_price?: number | null;
  price?: number | null;
  category_id?: number | null;
  is_archived?: boolean;
  custom_fields?: { name?: string; uuid?: string; value?: unknown }[];
};

type KOffer = {
  id: number;
  product_id: number;
  sku: string;
  price: number;
  quantity?: number | null;
  in_reserve?: number | null;
  is_archived?: boolean;
  properties?: { name: string; value: string }[] | null;
};

type KCategory = { id: number; name: string; parent_id: number | null };

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

// Перемикач «На сайт» у картці товару KeyCRM (користувацьке поле CT_1006).
function onSite(p: KProduct): boolean {
  const field = p.custom_fields?.find((f) => f.uuid === "CT_1006" || /на\s*сайт/i.test(f.name ?? ""));
  const v = field?.value;
  return v != null && v !== false && v !== 0 && v !== "" && v !== "0" && v !== "false";
}

function oldPriceFrom(p: KProduct): number | null {
  const field = p.custom_fields?.find((f) => /стара\s*ціна|old\s*price/i.test(f.name ?? ""));
  const value = Number(field?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function fetchCatalog(): Promise<{ products: Product[]; categories: Category[] }> {
  const [kProducts, kOffers, kCategories] = await Promise.all([
    all<KProduct>("/products?include=custom_fields&filter[is_archived]=false"),
    all<KOffer>("/offers?filter[is_archived]=false"),
    all<KCategory>("/products/categories"),
  ]);

  const offersByProduct = new Map<number, KOffer[]>();
  for (const o of kOffers) {
    const list = offersByProduct.get(o.product_id) ?? [];
    list.push(o);
    offersByProduct.set(o.product_id, list);
  }

  // Якщо хоч один товар позначено «На сайт», показуємо тільки позначені; інакше всі.
  const selected = kProducts.filter(onSite);
  const visible = selected.length > 0 ? selected : kProducts;

  const products: Product[] = visible
    .filter((p) => !p.is_archived)
    .map((p) => {
      const variants: Variant[] = (offersByProduct.get(p.id) ?? []).map((o) => {
        const size =
          o.properties?.find((pr) => /розмір|size/i.test(pr.name))?.value ??
          o.properties?.map((pr) => pr.value).join(" / ") ??
          "";
        // Товар береться під замовлення (1–3 дні), тому кожен розмір можна купити незалежно від залишку.
        return { id: o.id, sku: o.sku, size, price: o.price, inStock: true };
      });
      variants.sort((a, b) => parseFloat(a.size) - parseFloat(b.size) || a.size.localeCompare(b.size));
      const images = [p.thumbnail_url, ...(p.attachments_data ?? [])].filter(
        (u, i, arr): u is string => Boolean(u) && arr.indexOf(u) === i,
      );
      const price = variants.length ? Math.min(...variants.map((v) => v.price)) : (p.min_price ?? p.price ?? 0);
      return {
        id: p.id,
        slug: productSlug(p.id, p.name),
        name: p.name,
        description: stripHtml(p.description ?? ""),
        price,
        oldPrice: oldPriceFrom(p),
        images,
        categoryId: p.category_id ?? null,
        variants,
      };
    })
    // Ховаємо товари без фото, без розмірів і з нульовою ціною.
    .filter((p) => p.images.length > 0 && p.price > 0 && p.variants.length > 0);

  const categories: Category[] = kCategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: `${c.id}-${slugify(c.name)}`,
    parentId: c.parent_id,
  }));

  return { products, categories };
}

export async function createOrder(order: OrderRequest, total: number) {
  const env = process.env;
  const delivery = order.delivery;
  const deliveryServiceId =
    delivery?.service === "novaposhta"
      ? Number(env.KEYCRM_NOVAPOSHTA_ID) || undefined
      : delivery?.service === "ukrposhta"
        ? Number(env.KEYCRM_UKRPOSHTA_ID) || undefined
        : undefined;

  const body = {
    source_id: Number(env.KEYCRM_SOURCE_ID) || 1,
    buyer: { full_name: order.name, phone: order.phone },
    buyer_comment: order.comment || undefined,
    manager_comment: [
      order.quick ? "Швидке замовлення: передзвонити для уточнення доставки" : null,
      order.payment === "prepay" ? "Оплата: передоплата на картку" : "Оплата: накладений платіж",
    ]
      .filter(Boolean)
      .join(". "),
    shipping: delivery
      ? {
          delivery_service_id: deliveryServiceId,
          shipping_service: delivery.service === "novaposhta" ? "Нова Пошта" : "Укрпошта",
          shipping_address_city: delivery.city,
          shipping_address_country: "Ukraine",
          shipping_address_zip: delivery.zip || undefined,
          shipping_receive_point: delivery.point,
          warehouse_ref: delivery.service === "novaposhta" && deliveryServiceId ? delivery.warehouseRef : undefined,
          recipient_full_name: order.name,
          recipient_phone: order.phone,
        }
      : undefined,
    marketing: order.utm
      ? {
          utm_source: order.utm.utm_source,
          utm_medium: order.utm.utm_medium,
          utm_campaign: order.utm.utm_campaign,
          utm_term: order.utm.utm_term,
          utm_content: order.utm.utm_content,
        }
      : undefined,
    products: order.items.map((i) => ({
      sku: i.sku,
      price: i.price,
      quantity: i.quantity,
      name: i.name,
      picture: i.image,
      properties: i.size ? [{ name: "Розмір", value: i.size }] : undefined,
    })),
  };

  return request<{ id: number }>("/order", { method: "POST", body: JSON.stringify(body) });
}
