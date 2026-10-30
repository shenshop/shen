import "server-only";
import { request } from "./keycrm";
import { normalizePhone } from "./format";
import { searchCities, searchWarehouses } from "./novaposhta";

// Замовлення з повідомлення в боті (клієнт подзвонив або написав).
// Формат, кожне з нового рядка:
//   Іваненко Іван
//   0671234567
//   Київ 25          ← місто і номер відділення / поштомата Нової Пошти
//   221 кор-42       ← артикул з розміром; кожна пара окремим рядком
// Нічого не створюємо, поки Дрон не натисне «Так» під перевіркою.

const SOURCE = "дзвінок";
const fresh = { cache: "no-store" as const };
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

type KOffer = { id: number; sku: string; price: number; product?: { name?: string } | null; properties?: { name: string; value: string }[] | null };

export type ManualOrder = {
  name: string;
  phone: string;
  city: string;
  warehouse: { name: string; ref: string };
  items: { sku: string; name: string; size: string; price: number }[];
};

/** Схоже на замовлення: щонайменше 4 рядки, другий — телефон. */
export const looksLikeOrder = (text: string) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length >= 4 && normalizePhone(lines[1]) != null;
};

export async function parseManualOrder(text: string): Promise<{ order?: ManualOrder; error?: string }> {
  const [name, phoneLine, place, ...skus] = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const phone = normalizePhone(phoneLine);
  if (!phone) return { error: "Не розібрав телефон у 2-му рядку." };

  const m = place.match(/^(.*?)[,\s]+(?:відділення|відд\.?|поштомат|№)?\s*№?\s*(\d+)\s*$/i);
  if (!m) return { error: "У 3-му рядку напишіть місто і номер відділення, наприклад «Київ 25»." };
  const cityQuery = m[1].replace(/[,.]+$/, "").trim();
  const number = m[2];
  const cities = await searchCities(cityQuery);
  const city = cities.find((c) => norm(c.name) === norm(cityQuery)) ?? cities[0];
  if (!city) return { error: `Нова Пошта не знайшла місто «${cityQuery}».` };
  const warehouses = await searchWarehouses(city.ref, number);
  const warehouse = warehouses.find((w) => w.number === number);
  if (!warehouse) return { error: `У місті ${city.name} немає відділення чи поштомата №${number}.` };

  const items: ManualOrder["items"] = [];
  for (const sku of skus) {
    const offers = rows(await request<List<KOffer>>(`/offers?filter[sku]=${encodeURIComponent(sku)}&include=product&limit=5`, fresh));
    const offer = offers.find((o) => norm(o.sku) === norm(sku));
    if (!offer) return { error: `У KeyCRM немає товару з артикулом «${sku}».` };
    const size = offer.properties?.find((p) => /розмір|size/i.test(p.name))?.value ?? sku.match(/(\d{2}(?:[.,]5)?)$/)?.[1] ?? "";
    items.push({ sku: offer.sku, name: offer.product?.name?.trim() || offer.sku, size, price: Number(offer.price) || 0 });
  }
  return { order: { name, phone, city: city.name, warehouse: { name: warehouse.name, ref: warehouse.ref }, items } };
}

async function sourceId() {
  const list = rows(await request<List<{ id: number; name: string }>>("/order/source?limit=50", fresh));
  const id = list.find((s) => norm(s.name) === SOURCE)?.id;
  if (!id) throw new Error(`У KeyCRM немає джерела «Дзвінок». Джерела: ${list.map((s) => s.name).join(", ")}`);
  return id;
}

export async function createManualOrder(o: ManualOrder) {
  const body = {
    source_id: await sourceId(),
    buyer: { full_name: o.name, phone: o.phone },
    manager_comment: "Створено через Telegram-бота. Оплата: накладений платіж",
    shipping: {
      delivery_service_id: Number(process.env.KEYCRM_NOVAPOSHTA_ID) || undefined,
      shipping_service: "Нова Пошта",
      shipping_address_city: o.city,
      shipping_address_country: "Ukraine",
      shipping_receive_point: o.warehouse.name,
      warehouse_ref: o.warehouse.ref,
      recipient_full_name: o.name,
      recipient_phone: o.phone,
    },
    products: o.items.map((i) => ({
      sku: i.sku,
      price: i.price,
      quantity: 1,
      name: i.name,
      properties: i.size ? [{ name: "Розмір", value: i.size }] : undefined,
    })),
  };
  return request<{ id: number }>("/order", { method: "POST", body: JSON.stringify(body), ...fresh });
}
