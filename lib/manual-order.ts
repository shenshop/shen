import "server-only";
import { request } from "./keycrm";
import { normalizePhone } from "./format";
import { searchCities, searchWarehouses } from "./novaposhta";

// Замовлення з повідомлення в боті (клієнт подзвонив або написав). Кожне з нового рядка:
//   Іваненко Іван 0671234567     ← імʼя і телефон в одному рядку або двома рядками
//   Київ 25                      ← Нова Пошта: місто і номер відділення / поштомата («Нова Пошта Київ 25» теж можна)
//     або
//   Укрпошта індекс 12101        ← Укрпошта: індекс
//   Смт. Хорошів                 ←   і населений пункт окремим рядком
//   Olimp чорні 41               ← модель, колір, розмір; або точний артикул «221 кор-42». Кожна пара окремим рядком
// Нічого не створюємо, поки Дрон не натисне «Так» під перевіркою.

const SOURCE = "дзвінок";
const fresh = { cache: "no-store" as const };
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

type KOffer = {
  id: number;
  sku: string | null;
  price: number;
  product_id?: number;
  product?: { name?: string } | null;
  properties?: { name: string; value: string }[] | null;
};

export type ManualOrder = {
  name: string;
  phone: string;
  delivery:
    | { service: "novaposhta"; city: string; warehouse: { name: string; ref: string } }
    | { service: "ukrposhta"; city: string; zip: string };
  items: { sku: string; name: string; size: string; price: number }[];
};

// Телефон у рядку: 0960930843, 096 093 08 43, +38 (096) 093-08-43.
const PHONE = /(?:\+?\s*3\s*8\s*)?\(?0\d{2}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/;
const splitLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Імʼя і телефон: «Імʼя 0671234567» одним рядком або «Імʼя» / «0671234567» двома. Повертає, скільки рядків зайняли. */
function nameAndPhone(lines: string[]): { name: string; phone: string; used: number } | null {
  const inFirst = lines[0]?.match(PHONE);
  if (inFirst) {
    const phone = normalizePhone(inFirst[0]);
    const name = lines[0].replace(inFirst[0], " ").replace(/[,;:]+/g, " ").replace(/\s+/g, " ").trim();
    if (phone && name) return { name, phone, used: 1 };
  }
  const phone = lines[1] ? normalizePhone(lines[1]) : null;
  if (lines[0] && phone) return { name: lines[0], phone, used: 2 };
  return null;
}

/** Схоже на замовлення: телефон у 1-му рядку разом з імʼям або 2-м рядком, і ще щонайменше 2 рядки. */
export const looksLikeOrder = (text: string) => {
  const lines = splitLines(text);
  const np = nameAndPhone(lines);
  return np != null && lines.length - np.used >= 2;
};

// Для пошуку моделі: латиниця і кирилиця в одне написання («Olimp» = «Олімп»), без пробілів і дефісів.
const LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "e", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "sh", ь: "", ю: "u", я: "a", ы: "y", э: "e", ё: "e", ъ: "",
};
const latin = (s: string | null | undefined) =>
  norm(s)
    .replace(/[а-яіїєґёыэъ]/g, (c) => LAT[c] ?? c)
    .replace(/[yj]/g, "i")
    .replace(/[^a-z0-9]/g, "");
const sizeOf = (o: KOffer) => o.properties?.find((p) => /розмір|size/i.test(p.name))?.value?.trim() ?? o.sku?.match(/(\d{2}(?:[.,]5)?)\s*$/)?.[1] ?? "";
const colourOf = (o: KOffer) => o.properties?.find((p) => /колір|цвет|color/i.test(p.name))?.value?.trim() ?? "";
const baseSku = (sku: string | null | undefined) => (sku ?? "").replace(/[-\s]+\d{2}(?:[.,]5)?\s*$/, "");
const sameSize = (a: string, b: string) => a.replace(",", ".") === b.replace(",", ".");

async function allOffers(): Promise<KOffer[]> {
  const out: KOffer[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await request<{ data: KOffer[]; last_page?: number }>(`/offers?filter[is_archived]=false&include=product&limit=50&page=${page}`, fresh);
    out.push(...res.data);
    if (!res.last_page || page >= res.last_page) break;
  }
  return out;
}

const describe = (o: KOffer) => `${o.product?.name?.trim() || "?"}${colourOf(o) ? `, ${colourOf(o)}` : ""} (${o.sku})`;

/** Пара за рядком «Olimp чорні 41»: усі слова мають бути в артикулі, назві або кольорі, розмір — точно. */
function matchItem(line: string, offers: KOffer[]): { offer?: KOffer; error?: string } {
  // Точний артикул, навіть якщо замість дефіса пробіл: «221 кор 42» = «221 кор-42».
  const exact = offers.filter((o) => latin(o.sku) === latin(line));
  if (exact.length === 1) return { offer: exact[0] };

  const m = line.match(/^(.*?)[\s,\-]+(?:розмір|р\.?)?\s*(\d{2}(?:[.,]5)?)\s*(?:розмір|р\.?)?$/i);
  if (!m || !m[1].trim()) return { error: `Не розібрав рядок «${line}». Напишіть модель і розмір, наприклад «Olimp чорні 41», або артикул «221 кор-42».` };
  const size = m[2];
  const words = m[1].split(/[\s,]+/).map(latin).filter(Boolean);
  const fits = (o: KOffer) => {
    const text = latin(`${baseSku(o.sku)} ${o.product?.name ?? ""} ${colourOf(o)}`);
    const codes = norm(`${baseSku(o.sku)} ${o.product?.name ?? ""}`).split(/[\s\-–_,.()]+/).map(latin);
    // Слово з цифрами («к10», «1193») має збігтися з цілим словом артикулу чи назви, щоб «к1» не підходило до «к10».
    // Інші слова порівнюємо за початком: «чорні» підходить до «Чорний».
    return words.every((w) => (/\d/.test(w) ? codes.includes(w) || latin(baseSku(o.sku)) === w : text.includes(w.slice(0, 5))));
  };
  const found = offers.filter((o) => sameSize(sizeOf(o), size) && fits(o));
  if (found.length === 1) return { offer: found[0] };
  if (found.length > 1)
    return {
      error: `Під «${line}» підходить кілька товарів: ${found.slice(0, 6).map(describe).join("; ")}. Напишіть точніше або артикулом.`,
    };
  const anySize = offers.filter(fits);
  if (anySize.length)
    return { error: `«${m[1].trim()}» знайшов, але розміру ${size} у ньому немає (є: ${[...new Set(anySize.map(sizeOf))].sort().join(", ")}).` };
  return { error: `Не знайшов у KeyCRM товар «${m[1].trim()}».` };
}

// Рядок Укрпошти: «Укрпошта індекс 12101» або просто «Індекс 29003».
const UKR = /укрпошт|укр\.?\s*пошт|ukrposhta|^індекс[\s:№]*\d{5}|^\d{5}$/i;
const NP_PREFIX = /^(?:нова\s*пошта|нп)\s*[,:.\-]?\s*/i;
// «Смт. Хорошів», «м. Київ», «с.Іванівка» → назва без скорочення.
const cleanCity = (s: string) => s.replace(/^(?:смт|м|с|сел|село|місто|пгт|г)\.?\s+|^(?:смт|м|с)\.(?=\S)/i, "").replace(/[,.]+$/, "").trim();

export async function parseManualOrder(text: string): Promise<{ order?: ManualOrder; error?: string }> {
  const lines = splitLines(text);
  const who = nameAndPhone(lines);
  if (!who) return { error: "Не розібрав імʼя і телефон: напишіть їх першим рядком («Іваненко Іван 0671234567») або двома рядками." };
  let rest = lines.slice(who.used);

  let delivery: ManualOrder["delivery"];
  const ukrIdx = rest.findIndex((l) => UKR.test(l));
  if (ukrIdx >= 0) {
    // Індекс шукаємо в рядку «Укрпошта …», а населений пункт — у сусідньому рядку без розміру.
    let zip = rest[ukrIdx].match(/\b(\d{5})\b/)?.[1];
    let cityText = rest[ukrIdx].replace(UKR, " ").replace(/укрпошт\S*/i, " ").replace(/\S*\d{5}\S*/, " ").replace(/індекс|відділення|№|[,:]/gi, " ").replace(/\s+/g, " ").trim();
    const used = new Set([ukrIdx]);
    if (!zip) {
      const zi = rest.findIndex((l, i) => !used.has(i) && /^(?:індекс\s*)?\d{5}$/i.test(l));
      if (zi >= 0) { zip = rest[zi].match(/\d{5}/)![0]; used.add(zi); }
    }
    if (!zip) return { error: "Для Укрпошти потрібен індекс з 5 цифр, наприклад «Укрпошта індекс 12101»." };
    if (!cityText || cityText.length < 2) {
      // Населений пункт необовʼязковий: за індексом Укрпошта й так знає відділення.
      const ci = rest.findIndex((l, i) => !used.has(i) && !/\d{2}(?:[.,]5)?\s*$/.test(l));
      cityText = ci >= 0 ? rest[ci] : "";
      if (ci >= 0) used.add(ci);
    }
    delivery = { service: "ukrposhta", city: cleanCity(cityText), zip };
    rest = rest.filter((_, i) => !used.has(i));
  } else {
    // Нова Пошта: рядок одразу після імені й телефону.
    const place = rest[0].replace(NP_PREFIX, "");
    const m = place.match(/^(.*?)[,\s]+(?:відділення|відд\.?|поштомат|№)?\s*№?\s*(\d+)\s*$/i);
    if (!m) return { error: "Після телефону напишіть місто і номер відділення Нової Пошти («Київ 25») або «Укрпошта індекс 12101»." };
    const cityQuery = cleanCity(m[1].replace(/[,.]+$/, "").trim());
    const number = m[2];
    const cities = await searchCities(cityQuery);
    const city = cities.find((c) => norm(c.name) === norm(cityQuery)) ?? cities[0];
    if (!city) return { error: `Нова Пошта не знайшла місто «${cityQuery}».` };
    const warehouses = await searchWarehouses(city.ref, number);
    const warehouse = warehouses.find((w) => w.number === number);
    if (!warehouse) return { error: `У місті ${city.name} немає відділення чи поштомата №${number}.` };
    delivery = { service: "novaposhta", city: city.name, warehouse: { name: warehouse.name, ref: warehouse.ref } };
    rest = rest.slice(1);
  }

  if (!rest.length) return { error: "Не бачу товару: напишіть модель, колір і розмір, наприклад «Olimp чорні 41»." };
  const offers = await allOffers();
  const items: ManualOrder["items"] = [];
  for (const line of rest) {
    const { offer, error } = matchItem(line, offers);
    if (!offer) return { error };
    items.push({ sku: offer.sku ?? "", name: offer.product?.name?.trim() || offer.sku || "", size: sizeOf(offer), price: Number(offer.price) || 0 });
  }
  return { order: { name: who.name, phone: who.phone, delivery, items } };
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
    shipping:
      o.delivery.service === "ukrposhta"
        ? {
            delivery_service_id: Number(process.env.KEYCRM_UKRPOSHTA_ID) || undefined,
            shipping_service: "Укрпошта",
            shipping_address_city: o.delivery.city || undefined,
            shipping_address_country: "Ukraine",
            shipping_address_zip: o.delivery.zip,
            shipping_receive_point: `Відділення ${o.delivery.zip}`,
            recipient_full_name: o.name,
            recipient_phone: o.phone,
          }
        : {
            delivery_service_id: Number(process.env.KEYCRM_NOVAPOSHTA_ID) || undefined,
            shipping_service: "Нова Пошта",
            shipping_address_city: o.delivery.city,
            shipping_address_country: "Ukraine",
            shipping_receive_point: o.delivery.warehouse.name,
            warehouse_ref: o.delivery.warehouse.ref,
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
