import "server-only";
import { request } from "./keycrm";

// Відправлені замовлення, клієнтам яких ще не написали номер ТТН.
// «Надіслано» позначаємо тегом у KeyCRM, тож список не повторюється.

// «Передано в доставку» (8) і «У дорозі» (9): у обох посилка вже з ТТН.
const SHIPPED_STATUS_IDS = [8, 9];
const SENT_TAG = "ттн надіслано";
const RECENT_DAYS = 4;

type Named = { id: number; name: string };
type KOrder = {
  id: number;
  updated_at?: string;
  created_at?: string;
  buyer?: { full_name?: string; phone?: string } | null;
  shipping?: { delivery_service_id?: number | null; tracking_code?: string | null } | null;
  tags?: Named[] | null;
};
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export let stats = { inStatus: 0, withTtn: 0, notSent: 0, recent: 0, sample: "" };

// Час у KeyCRM в UTC: «2026-10-28 21:15:00» або ISO з «Z».
function parseTime(v?: string) {
  if (!v) return NaN;
  return Date.parse(/[TZ+]/.test(v) ? v : v.replace(" ", "T") + "Z");
}

export type TtnNotice = { id: number; buyer: string; phone: string; ttn: string; nova: boolean };

// Id тегу не змінюється: запамʼятовуємо, щоб кожне «✅ Надіслано» коштувало 1 запит до KeyCRM, а не 2.
let cachedTagId: number | null = null;
async function sentTagId() {
  if (cachedTagId) return cachedTagId;
  const tags = rows(await request<List<Named>>("/order/tag?limit=50", fresh));
  const id = tags.find((t) => norm(t.name) === SENT_TAG)?.id;
  if (!id) throw new Error("У KeyCRM немає тегу «ТТН надіслано». Створіть його в налаштуваннях тегів замовлень.");
  cachedTagId = id;
  return id;
}

export async function ordersToNotify(): Promise<TtnNotice[]> {
  // «Передано в доставку» у KeyCRM — статус №8 (за назвою шукати не можна: є схожі назви).
  // Замовлення, які змінювались за останні 4 дні (передали в доставку, поїхали), з ТТН і без тегу «ТТН надіслано» (Дрон, 2026-11-04).
  const tagId = await sentTagId();
  const services = rows(await request<List<Named>>("/order/delivery-service?limit=50", fresh));
  const novaIds = new Set(services.filter((s) => /^нп$|нова\s*пошта/i.test(s.name.trim())).map((s) => s.id));

  const orders: KOrder[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await request<List<KOrder> & { next_page_url?: string | null }>(
      `/order?filter[status_id]=${SHIPPED_STATUS_IDS.join(",")}&include=buyer,shipping.deliveryService,tags&sort=-id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...rows(res));
    if (Array.isArray(res) || !res.next_page_url) break;
  }
  const withTtn = orders.filter((o) => o.shipping?.tracking_code && o.buyer?.phone);
  const notSent = withTtn.filter((o) => !(o.tags ?? []).some((t) => t.id === tagId));
  const since = Date.now() - RECENT_DAYS * 86400_000;
  const recent = notSent.filter((o) => {
    const t = parseTime(o.updated_at ?? o.created_at);
    return Number.isNaN(t) || t >= since;
  });
  // Коли список порожній, пояснюємо чому: так легше помітити, якщо KeyCRM віддає дані інакше.
  stats = {
    inStatus: orders.length,
    withTtn: withTtn.length,
    notSent: notSent.length,
    recent: recent.length,
    sample: orders[0] ? `shipping: ${Object.keys(orders[0].shipping ?? {}).join(",")}; buyer: ${Object.keys(orders[0].buyer ?? {}).join(",")}` : "",
  };
  return recent
    .reverse()
    .map((o) => ({
      id: o.id,
      buyer: o.buyer?.full_name?.trim() || "",
      phone: o.buyer!.phone!,
      ttn: o.shipping!.tracking_code!.trim(),
      nova: novaIds.has(o.shipping?.delivery_service_id ?? -1),
    }));
}

export async function markSent(orderId: number) {
  await request(`/order/${orderId}/tag/${await sentTagId()}`, { method: "POST", ...fresh });
}

/** Номер для посилання у Viber: лише цифри, з кодом країни. */
export function viberDigits(phone: string) {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = "38" + d;
  return d;
}

export function customerText(n: TtnNotice) {
  return `Доброго дня! Ваше замовлення передано в доставку ${n.nova ? "Новою Поштою" : "Укрпоштою"} 📦\nНомер ТТН: ${n.ttn}\n\nДякуємо за покупку! SHEN`;
}
