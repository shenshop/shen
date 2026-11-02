import "server-only";
import { request } from "./keycrm";

// Перевірка складу для всіх замовлень «Виготовляється» і «Чекаєм поставку»: від найстаршого до найновішого,
// кожне отримує товар, якщо його вистачає на складі. Переводимо у «Готово до відгрузки»
// лише замовлення з Новою Поштою і тільки після підтвердження в Telegram.

const FROM_STATUS = "виготовляється";
const ALSO_FROM_STATUS = "чекаєм поставку"; // перевіряємо разом, якщо такий статус є
const TO_STATUS = "готово до відгрузки";
const WAREHOUSE = /основн/;
// KeyCRM дозволяє 20 запитів на хвилину, тож за одне натискання переводимо не більше стількох.
export const MAX_MOVES = 10;

type KStatus = { id: number; name: string };
type KOrderProduct = {
  name?: string;
  quantity: number;
  offer?: { id: number; sku?: string } | null;
  warehouse?: { id: number; name?: string } | null;
  warehouse_id?: number | null;
};
type KOrder = {
  status_id?: number;
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
export type PlannedOrder = { id: number; buyer: string; lines: Line[]; service: string; awaitingDelivery: boolean; problem?: string };
export type Plan = {
  fromIds: number[];
  toId: number;
  ready: PlannedOrder[]; // товар є, Нова Пошта: переводимо
  readyOther: PlannedOrder[]; // товар є, але інша служба доставки: лише показуємо
  waiting: PlannedOrder[];
  // Товар на «Основному» є, але в самому замовленні не вибрано склад або вибрано інший: не переводимо, пишемо Дронові.
  badWarehouse: PlannedOrder[];
};

// Усі служби доставки Нової Пошти в KeyCRM («НП» від сайту, «Нова Пошта» з інтеграції тощо).
async function deliveryServices() {
  const list = rows(await request<List<KStatus>>("/order/delivery-service?limit=50", fresh));
  const npIds = new Set(list.filter((s) => /^нп$|нова\s*пошта|nova\s*po[sc]h?ta/i.test(s.name.trim())).map((s) => s.id));
  npIds.add(Number(process.env.KEYCRM_NOVAPOSHTA_ID) || 4);
  return { npIds, names: new Map(list.map((s) => [s.id, s.name.trim()])) };
}

async function statusIds() {
  const list = rows(await request<List<KStatus>>("/order/status?limit=50", fresh));
  const find = (name: string) => list.find((s) => norm(s.name) === name)?.id;
  const fromId = find(FROM_STATUS);
  const alsoId = find(ALSO_FROM_STATUS);
  const toId = find(TO_STATUS);
  if (!fromId || !toId) throw new Error(`У KeyCRM не знайдено статус «Виготовляється» або «Готово до відгрузки»`);
  return { fromIds: alsoId ? [fromId, alsoId] : [fromId], alsoId, toId };
}

export async function buildPlan(): Promise<Plan> {
  const { fromIds, alsoId, toId } = await statusIds();
  const { npIds, names } = await deliveryServices();

  const orders: KOrder[] = [];
  for (let page = 1; page <= 4; page++) {
    const res = await request<List<KOrder>>(
      `/order?filter[status_id]=${fromIds.join(",")}&include=products.offer,shipping.deliveryService,buyer&sort=id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...rows(res));
    if (Array.isArray(res) || !res.next_page_url) break;
  }
  orders.sort((a, b) => a.id - b.id);

  // Скільки кожного варіанту вільно на складі «Основний» (залишок мінус резерв).
  const offerIds = [...new Set(orders.flatMap((o) => (o.products ?? []).map((p) => p.offer?.id).filter(Boolean)))];
  const free = new Map<number, number>();
  for (let i = 0; i < offerIds.length; i += 50) {
    const ids = offerIds.slice(i, i + 50).join(",");
    const res = await request<List<KStock>>(`/offers/stocks?filter[details]=true&filter[offers_id]=${ids}&limit=50`, fresh);
    for (const s of rows(res)) {
      // Лише склад «Основний» («Основний склад» теж). Немає його в залишках — вважаємо, що товару нема,
      // а не беремо загальний залишок з усіх складів. Мінус або 0 — теж нема.
      const wh = s.warehouse?.find((w) => WAREHOUSE.test(norm(w.name)));
      const left = wh ? Number(wh.quantity) - Number(wh.reserve || 0) : 0;
      free.set(s.id, Number.isFinite(left) ? Math.max(0, left) : 0);
    }
  }

  const ready: PlannedOrder[] = [];
  const readyOther: PlannedOrder[] = [];
  const waiting: PlannedOrder[] = [];
  const badWarehouse: PlannedOrder[] = [];
  for (const o of orders) {
    const serviceId = o.shipping?.delivery_service_id ?? -1;
    const products = o.products ?? [];
    const lines = products.map((p) => ({ sku: p.offer?.sku || p.name || "?", qty: p.quantity || 1 }));
    const service = names.get(serviceId) ?? "без служби доставки";
    const entry = { id: o.id, buyer: o.buyer?.full_name?.trim() || "", lines, service, awaitingDelivery: o.status_id === alsoId };
    // Потрібна кількість по кожному варіанту (у замовленні може бути кілька однакових позицій).
    const need = new Map<number, number>();
    let known = products.length > 0;
    for (const p of products) {
      if (!p.offer?.id) known = false;
      else need.set(p.offer.id, (need.get(p.offer.id) ?? 0) + (p.quantity || 1));
    }
    const enough = known && [...need].every(([id, q]) => (free.get(id) ?? 0) >= q);
    if (!enough) {
      waiting.push(entry);
      continue;
    }
    // Склад у позиціях замовлення: KeyCRM списує саме з нього. Якщо не «Основний» — не переводимо.
    const problem = warehouseProblem(products);
    if (problem) {
      badWarehouse.push({ ...entry, problem });
      continue;
    }
    for (const [id, q] of need) free.set(id, (free.get(id) ?? 0) - q);
    (npIds.has(serviceId) ? ready : readyOther).push(entry);
  }
  return { fromIds, toId, ready, readyOther, waiting, badWarehouse };
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

function warehouseProblem(products: KOrderProduct[]) {
  // Якщо KeyCRM взагалі не віддає склад у позиціях, перевірити не можемо — покладаємось на залишок «Основного».
  const reported = products.some((p) => "warehouse" in p || "warehouse_id" in p);
  if (!reported) return "";
  for (const p of products) {
    const name = p.warehouse?.name?.trim();
    if (!p.warehouse && !p.warehouse_id) return `склад не вибраний (${p.offer?.sku || p.name || "товар"})`;
    if (name && !WAREHOUSE.test(norm(name))) return `вибрано склад «${name}», а не «Основний» (${p.offer?.sku || p.name || "товар"})`;
  }
  return "";
}
