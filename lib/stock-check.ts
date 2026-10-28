import "server-only";
import { request } from "./keycrm";

// Перевірка складу для замовлень «Виготовляється» (лише Нова Пошта):
// від найстаршого до найновішого, кожне отримує товар, якщо його вистачає на складі.
// Переводимо у «Готово до відгрузки» тільки після підтвердження в Telegram.

const FROM_STATUS = "виготовляється";
const TO_STATUS = "готово до відгрузки";
const WAREHOUSE = "основний";
// KeyCRM дозволяє 20 запитів на хвилину, тож за одне натискання переводимо не більше стількох.
export const MAX_MOVES = 12;

type KStatus = { id: number; name: string };
type KOrderProduct = {
  name?: string;
  quantity: number;
  offer?: { id: number; sku?: string } | null;
  warehouse?: { id: number; name?: string } | null;
};
type KOrder = {
  id: number;
  created_at?: string;
  buyer?: { full_name?: string } | null;
  shipping?: { delivery_service_id?: number | null } | null;
  products?: KOrderProduct[];
};
type KStock = {
  id: number;
  sku?: string;
  quantity: number;
  reserve: number;
  warehouse?: { id: number; name: string; quantity: number; reserve: number }[];
};

type List<T> = T[] | { data: T[]; next_page_url?: string | null };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type Line = { sku: string; qty: number };
export type PlannedOrder = { id: number; buyer: string; lines: Line[] };
export type Plan = { fromId: number; toId: number; ready: PlannedOrder[]; waiting: PlannedOrder[] };

async function statusIds() {
  const list = rows(await request<List<KStatus>>("/order/status?limit=50", fresh));
  const find = (name: string) => list.find((s) => norm(s.name) === name)?.id;
  const fromId = find(FROM_STATUS);
  const toId = find(TO_STATUS);
  if (!fromId || !toId) throw new Error(`У KeyCRM не знайдено статус «Виготовляється» або «Готово до відгрузки»`);
  return { fromId, toId };
}

export async function buildPlan(): Promise<Plan> {
  const { fromId, toId } = await statusIds();
  const npId = Number(process.env.KEYCRM_NOVAPOSHTA_ID) || 4;

  const orders: KOrder[] = [];
  for (let page = 1; page <= 4; page++) {
    const res = await request<List<KOrder>>(
      `/order?filter[status_id]=${fromId}&include=products.offer,shipping.deliveryService,buyer&sort=id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...rows(res));
    if (Array.isArray(res) || !res.next_page_url) break;
  }
  const np = orders.filter((o) => o.shipping?.delivery_service_id === npId).sort((a, b) => a.id - b.id);

  // Скільки кожного варіанту вільно на складі «Основний» (залишок мінус резерв).
  const offerIds = [...new Set(np.flatMap((o) => (o.products ?? []).map((p) => p.offer?.id).filter(Boolean)))];
  const free = new Map<number, number>();
  for (let i = 0; i < offerIds.length; i += 50) {
    const ids = offerIds.slice(i, i + 50).join(",");
    const res = await request<List<KStock>>(`/offers/stocks?filter[details]=true&filter[offers_id]=${ids}&limit=50`, fresh);
    for (const s of rows(res)) {
      const wh = s.warehouse?.find((w) => norm(w.name) === WAREHOUSE);
      const left = wh ? wh.quantity - wh.reserve : s.quantity - s.reserve;
      free.set(s.id, Math.max(0, left));
    }
  }

  const ready: PlannedOrder[] = [];
  const waiting: PlannedOrder[] = [];
  for (const o of np) {
    const products = o.products ?? [];
    const lines = products.map((p) => ({ sku: p.offer?.sku || p.name || "?", qty: p.quantity || 1 }));
    const entry = { id: o.id, buyer: o.buyer?.full_name?.trim() || "", lines };
    // Потрібна кількість по кожному варіанту (у замовленні може бути кілька однакових позицій).
    const need = new Map<number, number>();
    let known = products.length > 0;
    for (const p of products) {
      if (!p.offer?.id) known = false;
      else need.set(p.offer.id, (need.get(p.offer.id) ?? 0) + (p.quantity || 1));
    }
    const enough = known && [...need].every(([id, q]) => (free.get(id) ?? 0) >= q);
    if (enough) {
      for (const [id, q] of need) free.set(id, (free.get(id) ?? 0) - q);
      ready.push(entry);
    } else waiting.push(entry);
  }
  return { fromId, toId, ready, waiting };
}

export async function moveOrders(plan: Plan) {
  const moved: PlannedOrder[] = [];
  let error = "";
  for (const o of plan.ready.slice(0, MAX_MOVES)) {
    try {
      await request(`/order/${o.id}`, { method: "PUT", body: JSON.stringify({ status_id: plan.toId }), ...fresh });
      moved.push(o);
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
      break;
    }
  }
  return { moved, error };
}
