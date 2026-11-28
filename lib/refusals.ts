import "server-only";
import { request } from "./keycrm";

// Замовлення, від яких клієнт відмовився на пошті (посилка повертається).
// Статус шукаємо за назвою, а «Написав» позначаємо тегом у KeyCRM,
// тож одного клієнта бот не показує двічі.

const DONE_TAG = "відмова уточнена";
const RECENT_HOURS = 10;
// Лише «Відмова від отримання»: скасовані та інші повернення сюди не потрапляють.
const REFUSAL_STATUS = /^відмова від отриман/i;

type Named = { id: number; name: string };
type KOrder = {
  id: number;
  updated_at?: string;
  buyer?: { full_name?: string; phone?: string } | null;
  products?: { name?: string; properties?: { name: string; value: string }[] | null; offer?: { sku?: string } | null }[] | null;
  tags?: Named[] | null;
  shipping?: { tracking_code?: string | null } | null;
  manager_comment?: string | null;
};
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function parseTime(v?: string) {
  if (!v) return NaN;
  return Date.parse(/[TZ+]/.test(v) ? v : v.replace(" ", "T") + "Z");
}

export type Refusal = { id: number; buyer: string; phone: string; status: string; items: string; ttn: string };

async function doneTagId() {
  const tags = rows(await request<List<Named>>("/order/tag?limit=50", fresh));
  const id = tags.find((t) => norm(t.name) === DONE_TAG)?.id;
  if (!id) throw new Error("У KeyCRM немає тегу «Відмова уточнена». Створіть його в налаштуваннях тегів замовлень.");
  return id;
}

export async function refusals(hours = RECENT_HOURS): Promise<{ list: Refusal[]; statuses: string[] }> {
  const all = rows(await request<List<Named>>("/order/status?limit=50", fresh));
  const matched = all.filter((s) => REFUSAL_STATUS.test(s.name.trim()));
  if (!matched.length) {
    throw new Error(`Не знайшов статус «Відмова від отримання». Статуси в KeyCRM: ${all.map((s) => s.name).join(", ")}`);
  }
  const names = new Map(matched.map((s) => [s.id, s.name]));
  const tagId = await doneTagId();
  const orders = rows(
    await request<List<KOrder & { status_id: number }>>(
      `/order?filter[status_id]=${matched.map((s) => s.id).join(",")}&include=buyer,products.offer,tags,shipping&sort=-id&limit=50`,
      fresh,
    ),
  );
  const since = Date.now() - hours * 3600_000;
  const list = orders
    .filter((o) => o.buyer?.phone && !(o.tags ?? []).some((t) => t.id === tagId))
    .filter((o) => {
      const t = parseTime(o.updated_at);
      return Number.isNaN(t) || t >= since;
    })
    .reverse()
    .map((o) => ({
      id: o.id,
      buyer: o.buyer?.full_name?.trim() || "",
      phone: o.buyer!.phone!,
      status: names.get(o.status_id) ?? "",
      ttn: o.shipping?.tracking_code?.trim() || "",
      items: (o.products ?? []).map((p) => p.offer?.sku || p.name || "").filter(Boolean).join(", "),
    }));
  return { list, statuses: matched.map((s) => s.name) };
}

// Відмови за останні 2 тижні в статусі «Відмова від отримання» (без фільтра за тегом).
async function recentRefusalOrders() {
  const all = rows(await request<List<Named>>("/order/status?limit=50", fresh));
  const ids = all.filter((s) => REFUSAL_STATUS.test(s.name.trim())).map((s) => s.id);
  if (!ids.length) return [];
  const orders = rows(
    await request<List<KOrder & { status_id: number }>>(
      `/order?filter[status_id]=${ids.join(",")}&include=buyer,products.offer,tags,shipping&sort=-id&limit=50`,
      fresh,
    ),
  );
  const since = Date.now() - 14 * 86400_000;
  return orders.filter((o) => {
    const t = parseTime(o.updated_at);
    return Number.isNaN(t) || t >= since;
  });
}

const toRefusal = (o: KOrder) => ({
  id: o.id,
  buyer: o.buyer?.full_name?.trim() || "",
  phone: o.buyer?.phone || "",
  status: "",
  items: (o.products ?? []).map((p) => p.offer?.sku || p.name || "").filter(Boolean).join(", "),
  ttn: o.shipping?.tracking_code?.trim() || "",
});
const hasReason = (o: KOrder) => /Причина відмови:/i.test(o.manager_comment ?? "");

/** Клієнту вже написали («Написав» поставив тег), а причину ще не записано. */
export async function awaitingReason(): Promise<Refusal[]> {
  const tagId = await doneTagId();
  return (await recentRefusalOrders())
    .filter((o) => (o.tags ?? []).some((t) => t.id === tagId) && !hasReason(o))
    .map(toRefusal);
}

/** Пошук відмови за номером ТТН (Нова Пошта або Укрпошта). */
export async function findRefusalByTtn(ttn: string): Promise<Refusal[]> {
  const q = ttn.replace(/\s+/g, "").toUpperCase();
  return (await recentRefusalOrders())
    .filter((o) => (o.shipping?.tracking_code ?? "").replace(/\s+/g, "").toUpperCase() === q)
    .map(toRefusal);
}

export async function markRefusalDone(orderId: number) {
  await request(`/order/${orderId}/tag/${await doneTagId()}`, { method: "POST", ...fresh });
}

export const refusalText = "Доброго дня, бачу посилка повертається, не підійшов розмір?\nМалі чи великі?";

export const REASONS: Record<string, string> = { small: "Малі", big: "Великі", dislike: "Не сподобались" };

/** Дописує причину відмови в коментар менеджера в KeyCRM і ставить тег «Відмова уточнена». */
export async function saveRefusalReason(orderId: number, reason: string) {
  const order = await request<{ manager_comment?: string | null }>(`/order/${orderId}`, fresh);
  const note = `Причина відмови: ${reason.trim().slice(0, 500)}`;
  const manager_comment = [order.manager_comment?.trim(), note].filter(Boolean).join("\n");
  await request(`/order/${orderId}`, { method: "PUT", body: JSON.stringify({ manager_comment }), ...fresh });
  await markRefusalDone(orderId);
}
