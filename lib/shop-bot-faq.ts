import "server-only";
import { request } from "./keycrm";
import { esc } from "./telegram";
import { settings } from "@/data/settings";
import { sizeChartFor } from "@/data/sizes";

// Готові відповіді бота для клієнтів: кнопки під полем вводу і типові питання своїми словами.
// Тексти затвердив Дрон 2026-11-01. Щоб змінити відповідь, правте тексти нижче.

export const BTN = {
  delivery: "🚚 Доставка і оплата",
  exchange: "🔄 Обмін",
  sizes: "📏 Розміри",
  order: "📦 Де моє замовлення",
} as const;
type Topic = keyof typeof BTN;

export const MENU = {
  keyboard: [[{ text: BTN.delivery }, { text: BTN.exchange }], [{ text: BTN.sizes }, { text: BTN.order }]],
  resize_keyboard: true,
  is_persistent: true,
};

const TEXT = {
  delivery:
    "🚚 Відправляємо Новою Поштою або Укрпоштою по всій Україні за 1–3 дні.\n\n" +
    "💳 Оплата при отриманні: спершу приміряєте на пошті, потім оплачуєте. Доставку оплачує отримувач за тарифами пошти. Також можна передоплатою на картку." +
    (settings.secondPairDiscount ? `\n\n🎁 За 2 пари знижка ${settings.secondPairDiscount} грн.` : ""),
  exchange: "🔄 Якщо розмір не підійшов, обміняємо протягом 14 днів. Напишіть нам тут, і ми підкажемо, як відправити.",
  sizes: "📏 Моделі повномірні. Напишіть довжину стопи в см або розмір, який зазвичай носите, і ми підберемо.",
};

// Вільний текст: відповідаємо лише на питання (є «?» або питальне слово), щоб не відповідати
// на «Устілка 24,5 см» чи «оплачу на пошті».
const QUESTION = /\?|^(а\s+)?(як|коли|де|скільки|чи|яка|який|які|можна|підкажіть|скажіть)(\s|$)/i;
// «Є 43 у чорному?» — питання про наявність: відповідає Дрон.
const AVAILABILITY = /^(а\s+)?є\s|наявн|залишил/i;
const PATTERNS: [Topic, RegExp][] = [
  ["order", /де\s+(моє|мій|моя|наше)|статус|ттн|трек|накладн|(коли|вже).*(відправ|прийде|приїде|буде)|відправили/i],
  ["exchange", /обмін|обміня|поверн|не\s+підій|не\s+підх|замал|завелик/i],
  ["delivery", /достав|оплат|наложк|наклад\w*\s+плат|пошт|скільки\s+(йде|їде)|передплат|карт/i],
  ["sizes", /розмір|маломір|великомір|повномір|устілк|довжин/i],
];

/** Яку відповідь дати: button — клієнт натиснув кнопку (Дронові пересилати не треба). */
export function matchFaq(text: string): { topic: Topic; button: boolean } | null {
  const t = text.trim();
  const button = (Object.keys(BTN) as Topic[]).find((k) => BTN[k] === t);
  if (button) return { topic: button, button: true };
  if (t.length > 300 || !QUESTION.test(t) || AVAILABILITY.test(t)) return null;
  const hit = PATTERNS.find(([, re]) => re.test(t));
  return hit ? { topic: hit[0], button: false } : null;
}

type KOrder = {
  id: number;
  status_id?: number;
  shipping?: { tracking_code?: string | null } | null;
  products?: { name: string; properties?: { name: string; value: string }[] | null }[];
};
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };

function statusText(name: string, ttn?: string | null) {
  const n = name.toLowerCase();
  if (/відмов|скасов|поверн/.test(n)) return "скасовано";
  if (/викон|отриман|заверш/.test(n)) return "отримано ✅";
  if (/прибул/.test(n)) return `чекає вас у відділенні 📬${ttn ? `\nНомер ТТН: ${ttn}` : ""}`;
  if (ttn) return `передано в доставку 📦\nНомер ТТН: ${ttn}`;
  if (/готов/.test(n)) return "готове, скоро відправимо 📦";
  return "готуємо до відправки (1–3 дні) 👟";
}

/** Текст відповіді (HTML). orders — замовлення, привʼязані до цього чату. */
export async function faqAnswer(topic: Topic, orders: number[]): Promise<string> {
  if (topic === "delivery" || topic === "exchange") return esc(TEXT[topic]);
  const recent = orders.slice(-3).reverse();
  if (topic === "sizes") {
    if (!recent.length) return esc(TEXT.sizes);
    const o = await request<KOrder>(`/order/${recent[0]}?include=products`, fresh).catch(() => null);
    const lines = (o?.products ?? []).map((p) => {
      const size = p.properties?.find((x) => /розмір|size/i.test(x.name))?.value?.trim();
      const cm = size ? sizeChartFor(p.name)[size] : undefined;
      return size ? `👟 ${esc(p.name)}: розмір <b>${esc(size)}</b>${cm ? `, устілка ${cm} см` : ""}` : "";
    });
    return [esc(TEXT.sizes), "", `Ваше замовлення №${recent[0]}:`, ...lines.filter(Boolean)].join("\n");
  }
  if (!recent.length) {
    return "Тут поки не бачу ваших замовлень. Напишіть, будь ласка, номер замовлення або телефон, і менеджер підкаже 🙌";
  }
  const statuses = rows(await request<List<{ id: number; name: string }>>("/order/status?limit=50", fresh));
  const names = new Map(statuses.map((s) => [s.id, s.name]));
  const parts: string[] = [];
  for (const id of recent) {
    const o = await request<KOrder>(`/order/${id}?include=shipping`, fresh).catch(() => null);
    if (!o) continue;
    parts.push(`<b>Замовлення №${id}</b>: ${esc(statusText(names.get(o.status_id ?? -1) ?? "", o.shipping?.tracking_code?.trim()))}`);
  }
  return parts.length ? parts.join("\n\n") : "Не вдалося перевірити замовлення. Менеджер подивиться і відповість 🙌";
}
