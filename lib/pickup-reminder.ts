import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { request } from "./keycrm";

// Посилки Нової Пошти і Укрпошти, які лежать у відділенні вже 3-й день, а клієнт їх не забрав.
// Укрпошта: API відстеження в нас немає, тож день прибуття = коли KeyCRM поставив статус «Прибув у відділення».
// Беремо замовлення в статусі «Прибуло до відділення» з ТТН, дату прибуття питаємо в Нової Пошти.
// «Написав» позначаємо тегом у KeyCRM, щоб бот не нагадував про ту саму посилку.

const ARRIVED_STATUS = /прибул|прибув/i;
const DONE_TAG = "нагадали забрати";
const DAYS_WAITING = 2; // день прибуття — 1-й, отже на 3-й день минуло 2 дні
// Друге нагадування на 5-й день (останній день безкоштовного зберігання НП), навіть якщо вже нагадали.
const FINAL_DAY = 5;
type KV = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
const kv = () => (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
const finalKey = (id: number) => `pickup:final:${id}`;
const ARRIVED = new Set(["7", "8"]); // 7 — прибув у відділення, 8 — у поштомат

type Named = { id: number; name: string };
type KOrder = {
  id: number;
  status_changed_at?: string | null;
  updated_at?: string | null;
  buyer?: { full_name?: string; phone?: string } | null;
  shipping?: { delivery_service_id?: number | null; tracking_code?: string | null; shipping_receive_point?: string | null } | null;
  tags?: Named[] | null;
};
type NpStatus = { Number: string; StatusCode: string; Status: string; ActualDeliveryDate?: string; DatePayedKeeping?: string };
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type Pickup = { id: number; buyer: string; phone: string; ttn: string; point: string; days: number; storageFrom: string; ukr?: boolean; final?: boolean };

// Час у KeyCRM в UTC: «2026-10-28 21:15:00» або ISO.
const parseUtc = (v: string) => Date.parse(/[TZ+]/.test(v) ? v : v.replace(" ", "T") + "Z");

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
  const services = rows(await request<List<Named>>("/order/delivery-service?limit=50", fresh));
  const ukrIds = new Set(services.filter((s) => /укрпошт|ukrposhta/i.test(s.name)).map((s) => s.id));
  const orders: KOrder[] = [];
  for (let page = 1; page <= 4; page++) {
    const res = await request<{ data: KOrder[]; next_page_url?: string | null }>(
      `/order?filter[status_id]=${arrivedIds.join(",")}&include=buyer,shipping,tags&sort=-id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...res.data);
    if (!res.next_page_url) break;
  }
  const open = orders.filter((o) => o.buyer?.phone && o.shipping?.tracking_code?.trim());
  const tagged = new Set(open.filter((o) => (o.tags ?? []).some((t) => t.id === tagId)).map((o) => o.id));
  const today = kyivDay(Date.now());
  const ukr: Pickup[] = open
    .filter((o) => ukrIds.has(o.shipping?.delivery_service_id ?? -1))
    .flatMap((o) => {
      const at = o.status_changed_at || o.updated_at;
      const t = at ? parseUtc(at) : NaN;
      if (Number.isNaN(t)) return [];
      const days = daysBetween(kyivDay(t), today);
      if (days < DAYS_WAITING) return [];
      return [{
        id: o.id,
        buyer: o.buyer?.full_name?.trim() || "",
        phone: o.buyer!.phone!,
        ttn: o.shipping!.tracking_code!.trim(),
        point: o.shipping?.shipping_receive_point?.trim() || "",
        days: days + 1,
        storageFrom: "",
        ukr: true,
      }];
    });
  const candidates = open.filter((o) => /^\d{14}$/.test(o.shipping!.tracking_code!.trim()) && !ukrIds.has(o.shipping?.delivery_service_id ?? -1));
  if (!candidates.length) return due(ukr, tagged);
  const byTtn = new Map((await npStatuses(candidates.map((o) => o.shipping!.tracking_code!.trim()))).map((s) => [s.Number, s]));
  const np: Pickup[] = candidates
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
    });
  return due([...np, ...ukr], tagged);
}

// Перше нагадування — з 3-го дня, якщо ще не нагадували (тег). Друге — з 5-го дня, один раз (позначка в KV).
async function due(list: Pickup[], tagged: Set<number>) {
  const out: Pickup[] = [];
  for (const p of list.sort((a, b) => a.id - b.id)) {
    if (!tagged.has(p.id)) out.push(p.days >= FINAL_DAY ? { ...p, final: true } : p);
    else if (p.days >= FINAL_DAY && !(await kv().get(finalKey(p.id)))) out.push({ ...p, final: true });
  }
  return out;
}

export async function markReminded(orderId: number, final = false) {
  // Позначку 5-го дня ставимо завжди, коли нагадали на 5-й день і пізніше, щоб не нагадувати вдруге.
  if (final) await kv().put(finalKey(orderId), "1", { expirationTtl: 60 * 60 * 24 * 30 });
  const tag = request(`/order/${orderId}/tag/${await doneTagId()}`, { method: "POST", ...fresh });
  // На 5-й день тег зазвичай уже стоїть: повторне додавання може дати помилку, вона не важлива.
  await (final ? tag.catch(() => null) : tag);
}

// Текст Дрона (31.10.2026); день рахуємо сам: на 3-й день — «3-й день», на 4-й — «4-й день».
export const pickupText = (p: Pickup) =>
  p.final
    ? p.ukr
      ? `Ваше замовлення чекає у відділенні Укрпошти вже ${p.days}-й день! 📦\nБудь ласка, заберіть його якнайшвидше, щоб посилку не повернули. Чекаємо на вас!`
      : `Ваше замовлення чекає у відділенні Нової Пошти вже ${p.days}-й день! 📦\n${p.days === FINAL_DAY ? "Сьогодні останній день безкоштовного зберігання" : "Безкоштовне зберігання вже закінчилось"}, далі Нова Пошта бере плату за зберігання.\nБудь ласка, заберіть посилку якнайшвидше. Чекаємо на вас!`
    : p.ukr
    ? `Ваше замовлення вже чекає у відділенні Укрпошти! 📦\n${p.days}-й день\nБудь ласка, заберіть його найближчим часом. Чекаємо на вас!`
    : `Ваше замовлення вже чекає у відділенні Нової Пошти! 📦\n${p.days}-й день\nБудь ласка, заберіть його найближчим часом.\nЗверніть увагу, що Нова Пошта зменшила термін безкоштовного зберігання до 5 днів. Чекаємо на вас!`;
