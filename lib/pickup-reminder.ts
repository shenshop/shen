import "server-only";
import { request } from "./keycrm";

// Посилки Нової Пошти, які лежать у відділенні вже 3-й день, а клієнт їх не забрав.
// Беремо замовлення в статусі «Прибуло до відділення» з ТТН, дату прибуття питаємо в Нової Пошти.
// «Написав» позначаємо тегом у KeyCRM, щоб бот не нагадував про ту саму посилку.

const ARRIVED_STATUS = /прибул|прибув/i;
const DONE_TAG = "нагадали забрати";
const DAYS_WAITING = 2; // день прибуття — 1-й, отже на 3-й день минуло 2 дні
const ARRIVED = new Set(["7", "8"]); // 7 — прибув у відділення, 8 — у поштомат

type Named = { id: number; name: string };
type KOrder = {
  id: number;
  buyer?: { full_name?: string; phone?: string } | null;
  shipping?: { delivery_service_id?: number | null; tracking_code?: string | null; shipping_receive_point?: string | null } | null;
  tags?: Named[] | null;
};
type NpStatus = { Number: string; StatusCode: string; Status: string; ActualDeliveryDate?: string; DatePayedKeeping?: string };
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type Pickup = { id: number; buyer: string; phone: string; ttn: string; point: string; days: number; storageFrom: string };

async function doneTagId() {
  const tags = rows(await request<List<Named>>("/order/tag?limit=50", fresh));
  const id = tags.find((t) => norm(t.name) === DONE_TAG)?.id;
  if (!id) throw new Error("У KeyCRM немає тегу «Нагадали забрати». Створіть його в налаштуваннях тегів замовлень.");
  return id;
}

// Дата в Києві («2026-10-28»), щоб рахувати календарні дні, а не години.
const kyivDay = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);

async function npStatuses(ttns: string[]): Promise<NpStatus[]> {
  const out: NpStatus[] = [];
  for (let i = 0; i < ttns.length; i += 100) {
    const res = await fetch("https://api.novaposhta.ua/v2.0/json/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        apiKey: process.env.NOVAPOSHTA_API_KEY ?? "",
        modelName: "TrackingDocument",
        calledMethod: "getStatusDocuments",
        methodProperties: { Documents: ttns.slice(i, i + 100).map((n) => ({ DocumentNumber: n })) },
      }),
    });
    const json = (await res.json()) as { success: boolean; data: NpStatus[]; errors: string[] };
    if (!json.success) throw new Error(`Нова Пошта: ${json.errors.join(", ")}`);
    out.push(...json.data);
  }
  return out;
}

export async function pickupsWaiting(): Promise<Pickup[]> {
  const statuses = rows(await request<List<Named>>("/order/status?limit=50", fresh));
  const arrivedIds = statuses.filter((s) => ARRIVED_STATUS.test(s.name)).map((s) => s.id);
  if (!arrivedIds.length) throw new Error(`Не знайшов статус «Прибуло до відділення». Статуси в KeyCRM: ${statuses.map((s) => s.name).join(", ")}`);
  const tagId = await doneTagId();
  const orders: KOrder[] = [];
  for (let page = 1; page <= 4; page++) {
    const res = await request<{ data: KOrder[]; next_page_url?: string | null }>(
      `/order?filter[status_id]=${arrivedIds.join(",")}&include=buyer,shipping,tags&sort=-id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...res.data);
    if (!res.next_page_url) break;
  }
  const candidates = orders.filter(
    (o) => o.buyer?.phone && /^\d{14}$/.test(o.shipping?.tracking_code?.trim() ?? "") && !(o.tags ?? []).some((t) => t.id === tagId),
  );
  if (!candidates.length) return [];
  const byTtn = new Map((await npStatuses(candidates.map((o) => o.shipping!.tracking_code!.trim()))).map((s) => [s.Number, s]));
  const today = kyivDay(Date.now());
  return candidates
    .flatMap((o) => {
      const ttn = o.shipping!.tracking_code!.trim();
      const s = byTtn.get(ttn);
      if (!s || !ARRIVED.has(String(s.StatusCode)) || !s.ActualDeliveryDate) return [];
      // Нова Пошта пише дату за київським часом: «2026-10-28 10:15:00».
      const arrived = s.ActualDeliveryDate.slice(0, 10);
      const days = daysBetween(arrived, today);
      if (days < DAYS_WAITING) return [];
      return [{
        id: o.id,
        buyer: o.buyer?.full_name?.trim() || "",
        phone: o.buyer!.phone!,
        ttn,
        point: o.shipping?.shipping_receive_point?.trim() || "",
        days: days + 1,
        storageFrom: s.DatePayedKeeping?.slice(0, 10) ?? "",
      }];
    })
    .reverse();
}

export async function markReminded(orderId: number) {
  await request(`/order/${orderId}/tag/${await doneTagId()}`, { method: "POST", ...fresh });
}

export const pickupText = (p: Pickup) =>
  `Доброго дня! Ваша посилка вже чекає у відділенні Нової Пошти${p.point ? ` (${p.point})` : ""}.\nНомер ТТН: ${p.ttn}\nОтримайте, будь ласка 🙏`;
