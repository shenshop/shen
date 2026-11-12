import "server-only";
import { request } from "./keycrm";
import { esc } from "./telegram";

// «Розміри по моделі»: по кожному розміру — скільки пар відправлено і що з ними зараз
// (забрали, в дорозі, у відділенні, відмова — повернеться), плюс що ще не відправлено.
// Допомагає вирішити, які розміри дозамовити.

export const DAYS = 60;

type Named = { id: number; name: string; alias?: string; is_closing_order?: boolean };
type KOrder = {
  id: number;
  status_id: number;
  shipping?: { tracking_code?: string | null } | null;
  products?: { name?: string; quantity?: number; offer?: { sku?: string } | null }[] | null;
};
type Res<T> = T[] | { data: T[]; next_page_url?: string | null };
const rows = <T>(r: Res<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };

export type Bucket = "done" | "transit" | "arrived" | "refused" | "canceled" | "ttn" | "waiting";

// Статус → що сталося з парою. Спершу відмову, бо «Відмова від отримання» теж містить «отриман».
export function bucketOf(s: Named): Bucket {
  const n = s.name.trim().toLowerCase();
  // Статуси Lurex — окремий бізнес, у звіт по взуттю не беремо.
  if (/lurex/.test(n)) return "canceled";
  if (/відмов|поверн|return/.test(n)) return "refused";
  if (/скасов|відмін|cancel|дубл|спам|тест|немає в наявн|нема в наявн|немає зв|нема зв|не відпов|недозвон/.test(n)) return "canceled";
  if (/прибул|прибув|у відділен|в відділен/.test(n)) return "arrived";
  if (/дороз|передано|відправлен|доставляєт/.test(n)) return "transit";
  if (/викон|отриман|забра|оплачен|заверш|успіш|complet/.test(n)) return "done";
  // Інші закриті статуси (без продажу) не рахуємо, щоб не вважати їх викупленими.
  if (s.is_closing_order) return "canceled";
  return "waiting";
}

// «221 кор-42» → модель «221 кор», розмір «42».
export function splitSku(sku: string) {
  const m = sku.trim().match(/^(.*?)[-\s]+(\d{2}(?:[.,]5)?)$/);
  return m ? { model: m[1].trim(), size: m[2].replace(",", ".") } : { model: sku.trim(), size: "—" };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function load() {
  const statuses = rows(await request<Res<Named>>("/order/status?limit=50", fresh));
  const bucket = new Map(statuses.map((s) => [s.id, bucketOf(s)]));
  const to = new Date();
  const from = new Date(Date.now() - DAYS * 86400_000);
  const range = encodeURIComponent(`${ymd(from)} 00:00:00, ${ymd(to)} 23:59:59`);
  const orders: KOrder[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await request<Res<KOrder>>(
      `/order?filter[created_between]=${range}&include=products.offer,shipping&sort=-id&limit=50&page=${page}`,
      fresh,
    );
    orders.push(...rows(res));
    if (Array.isArray(res) || !res.next_page_url) break;
  }
  return { orders, bucket, statuses };
}

// callback_data у Telegram до 64 байт: обрізаємо назву моделі однаково і в кнопці, і при пошуку.
export function modelKey(model: string) {
  let key = model;
  while (new TextEncoder().encode(`sz:${key}`).length > 64) key = key.slice(0, -1);
  return key;
}

/** Моделі із замовлень за останні DAYS днів, найпопулярніші першими. */
export async function modelList() {
  const { orders, bucket } = await load();
  const count = new Map<string, number>();
  for (const o of orders) {
    if (bucket.get(o.status_id) === "canceled") continue;
    for (const p of o.products ?? []) {
      const { model } = splitSku(p.offer?.sku || p.name || "");
      if (model) count.set(model, (count.get(model) ?? 0) + (p.quantity || 1));
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([model, n]) => ({ model, n }));
}

// Вільний залишок на складі «Основний» (кількість мінус резерв) по кожному розміру моделі.
type KStock = { id: number; sku?: string; warehouse?: { name: string; quantity: number; reserve: number }[] };
async function stockBySize(key: string) {
  const out = new Map<string, number>();
  for (let page = 1; page <= 40; page++) {
    const res = await request<Res<KStock>>(`/offers/stocks?filter[details]=true&limit=50&page=${page}`, fresh);
    for (const st of rows(res)) {
      const { model, size } = splitSku(st.sku ?? "");
      if (!st.sku || modelKey(model) !== key) continue;
      const wh = st.warehouse?.find((w) => /основн/i.test(w.name));
      const free = wh ? Number(wh.quantity) - Number(wh.reserve || 0) : 0;
      if (Number.isFinite(free) && free > 0) out.set(size, (out.get(size) ?? 0) + free);
    }
    if (Array.isArray(res) || !res.next_page_url) break;
  }
  return out;
}

// Стани в порядку показу, текстом.
const LABEL: Record<Exclude<Bucket, "canceled">, string> = {
  arrived: "У відділенні",
  transit: "В дорозі",
  ttn: "Є ТТН, ще не в дорозі",
  waiting: "Замовлено, не відправлено",
  refused: "Відмова, повертається",
  done: "Забрали",
};
const KEYS = Object.keys(LABEL) as (keyof typeof LABEL)[];
const bySizeNum = (a: [string, unknown], b: [string, unknown]) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]);
const sizesText = (m: Map<string, number>) => [...m].sort(bySizeNum).map(([size, n]) => `${esc(size)}-${n}`).join(", ");

/** Звіт по одній моделі: залишок на складі і де зараз пари із замовлень, згруповано за станом. */
export async function sizeReport(key: string) {
  const [{ orders, bucket }, stock] = await Promise.all([load(), stockBySize(key)]);
  // Стан → розмір → кількість, і номери замовлень для кожного стану.
  const byState = new Map<Bucket, Map<string, number>>();
  const ids = new Map<Bucket, Set<number>>();
  let name = key;
  for (const o of orders) {
    let b = bucket.get(o.status_id) ?? "waiting";
    if (b === "canceled") continue;
    // ТТН уже створено, а статус ще не «в дорозі»: пара фактично відправляється.
    if (b === "waiting" && o.shipping?.tracking_code?.trim()) b = "ttn";
    for (const p of o.products ?? []) {
      const { model, size } = splitSku(p.offer?.sku || p.name || "");
      if (modelKey(model) !== key) continue;
      name = model;
      const m = byState.get(b) ?? new Map<string, number>();
      m.set(size, (m.get(size) ?? 0) + (p.quantity || 1));
      byState.set(b, m);
      ids.set(b, (ids.get(b) ?? new Set()).add(o.id));
    }
  }

  const out = [`👟 <b>${esc(name)}</b>`, ""];
  out.push(`<b>На складі:</b> ${stock.size ? sizesText(stock) : "немає"}`);
  const atBranch = byState.get("arrived");
  if (atBranch?.size) {
    const nums = [...(ids.get("arrived") ?? [])].sort((x, y) => x - y).map((n) => `№ <code>${n}</code>`);
    out.push(`<b>У відділенні (ще не забрали):</b> ${sizesText(atBranch)}`, `   ${nums.join(", ")}`);
  }

  // Продано за DAYS днів по розмірах: усі замовлення, крім скасованих і відмов, найходовіші першими.
  const sold = new Map<string, number>();
  for (const [b, m] of byState) {
    if (b === "refused") continue;
    for (const [size, n] of m) sold.set(size, (sold.get(size) ?? 0) + n);
  }
  const popular = [...sold].sort((x, y) => y[1] - x[1] || bySizeNum(x, y));
  out.push("", `<b>Продано за ${DAYS} днів (без відмов):</b> ${popular.map(([size, n]) => `${esc(size)}-${n}`).join(", ") || "немає"}`);
  return out.join("\n");
}
