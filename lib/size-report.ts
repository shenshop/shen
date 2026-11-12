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

const ICON: Record<Exclude<Bucket, "canceled">, string> = {
  done: "✅",
  transit: "🚚",
  ttn: "📦",
  arrived: "🏤",
  refused: "↩️",
  waiting: "⏳",
};

/** Звіт по одній моделі: рядок на розмір. */
export async function sizeReport(key: string) {
  const { orders, bucket, statuses } = await load();
  const bySize = new Map<string, Record<Bucket, number>>();
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
      const r = bySize.get(size) ?? { done: 0, transit: 0, arrived: 0, refused: 0, canceled: 0, ttn: 0, waiting: 0 };
      r[b] += p.quantity || 1;
      bySize.set(size, r);
    }
  }
  if (!bySize.size) return `👟 <b>${esc(name)}</b>: за ${DAYS} днів замовлень немає.`;

  const sizes = [...bySize].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]));
  const lines = sizes.map(([size, r]) => {
    const parts = (Object.keys(ICON) as (keyof typeof ICON)[]).filter((k) => r[k]).map((k) => `${ICON[k]}${r[k]}`);
    return `<b>${esc(size)}</b> — ${parts.join(" ")}`;
  });
  const sum = (k: Bucket) => sizes.reduce((s, [, r]) => s + r[k], 0);
  const doneNames = statuses.filter((s) => bucket.get(s.id) === "done").map((s) => s.name.trim());
  return [
    `👟 <b>${esc(name)}</b>, замовлення за ${DAYS} днів`,
    "",
    ...lines,
    "",
    `Разом: ✅ забрали ${sum("done")} · 📦 є ТТН ${sum("ttn")} · 🚚 в дорозі ${sum("transit")} · 🏤 у відділенні ${sum("arrived")} · ↩️ відмова ${sum("refused")} · ⏳ ще не відправлено ${sum("waiting")}`,
    "",
    `↩️ відмова: пара повернеться на склад. 📦: ТТН створено, ще не в дорозі. ⏳: без ТТН (нове, виготовляється, чекає відправки).`,
    `✅ рахую статуси: ${esc(doneNames.join(", ") || "—")}`,
  ].join("\n");
}
