import "server-only";
import { request } from "./keycrm";
import { normalizePhone } from "./format";
import { searchCities, searchWarehouses } from "./novaposhta";

// Замовлення з повідомлення в боті (клієнт подзвонив або написав). Порядок будь-який, можна одним рядком:
//   Житомирська обл. Смт. Хорошів Войцеховська Тетяна Іванівна Укрпошта 1 індекс 12101 .0960930843
//   Olimp чорні 41               ← товар завжди окремим рядком: модель, колір, розмір або артикул «221 кор-42»
// Доставка: Укрпошта за індексом («Індекс 29003») або Нова Пошта («Львів 26», «м. Київ, відділення 25», «НП 25»).
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

/** Схоже на замовлення: є телефон і ще щось, крім нього (імʼя, доставка, товар). */
export const looksLikeOrder = (text: string) => {
  const p = text.match(PHONE);
  return !!p && normalizePhone(p[0]) != null && text.replace(p[0], " ").split(/\s+/).filter((w) => /[а-яіїєґa-z]/i.test(w)).length >= 2;
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

// «Смт. Хорошів», «м. Київ», «с.Іванівка» → назва без скорочення.
const cleanCity = (s: string) => s.replace(/^(?:смт|м|с|сел|село|місто|пгт|г)\.?\s+|^(?:смт|м|с)\.(?=\S)/i, "").replace(/[,.]+$/, "").trim();

// Ознаки доставки. Укрпошта: слово «Укрпошта», «індекс» або окреме 5-значне число.
const UKR_WORD = /укр\.?\s*пошт\S*|ukrposhta/i;
const ZIP = /(?:індекс\s*[:№]?\s*)?(?<![\d+])(\d{5})(?!\d)/i;
// Нова Пошта: «відділення 26», «НП 26», «Нова пошта №26», «поштомат 1234», «№26».
const NP_MARK = /(?:нова\s*пошта|(?<![а-яіїєґ])нп(?![а-яіїєґ])|відділення|відд\.?|поштомат|п\/м)\s*[№#:]?\s*(\d{1,5})(?!\d)|№\s*(\d{1,5})(?!\d)/i;
const NP_WORD = /нова\s*пошта|(?<![а-яіїєґ])нп(?![а-яіїєґ])/gi;
// «Житомирська обл.», «Хорошівський р-н» — область і район не потрібні.
const REGION = /[А-ЯІЇЄҐа-яіїєґʼ'’\-]+\s+(?:обл\.?|область|р-н\.?|район)(?![а-яіїєґ])/gi;
// «Смт. Хорошів», «м. Київ», «с.Іванівка».
const SETTLEMENT = /(?<![А-Яа-яІіЇїЄєҐґ])(?:[Сс]мт|[Пп]гт|[Мм]істо|[Сс]ело|[Сс]ел|[Мм]|[Сс]|[Гг])\.?\s*([А-ЯІЇЄҐ][а-яіїєґʼ'’\-]+)/;
const SIZE_END = /(?<!\d)(?:3[3-9]|4[0-8])(?:[.,]5)?\s*(?:р\.?|розмір)?\s*$/i;
const tidy = (s: string) => s.replace(/[,;:.]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => tidy(s).split(" ").filter((w) => /[а-яіїєґa-z]/i.test(w));

/**
 * Розбирає повідомлення в будь-якому порядку, навіть одним рядком, як пишуть клієнти:
 * «Житомирська обл. Смт. Хорошів Войцеховська Тетяна Іванівна Укрпошта 1 індекс 12101 .0960930843».
 * Товар — окремим рядком «Olimp чорні 41» або артикулом.
 */
export async function parseManualOrder(text: string): Promise<{ order?: ManualOrder; error?: string }> {
  const offers = await allOffers();
  let phone: string | null = null;
  let zip = "";
  let ukr = UKR_WORD.test(text);
  let npNumber = "";
  let city = "";
  const items: ManualOrder["items"] = [];
  const chunks: { text: string; hadPhone: boolean }[] = [];
  const places: { city: string; number: string }[] = []; // «Київ 25» — Нова Пошта старим форматом
  const failed: { line: string; error: string }[] = []; // рядки з розміром у кінці, що не підійшли до жодного товару

  for (const raw of splitLines(text)) {
    let line = raw;
    const p = line.match(PHONE);
    const hadPhone = !!p && !!normalizePhone(p[0]);
    if (p && hadPhone) {
      phone ??= normalizePhone(p[0]);
      line = line.replace(p[0], " ");
    }
    const delivery = UKR_WORD.test(line) || NP_MARK.test(line) || /індекс|обл|р-н|район/i.test(line);
    // Товар: рядок без телефону й доставки, що закінчується розміром.
    if (!hadPhone && !delivery && SIZE_END.test(line)) {
      const { offer, error } = matchItem(tidy(line), offers);
      if (offer) {
        items.push({ sku: offer.sku ?? "", name: offer.product?.name?.trim() || offer.sku || "", size: sizeOf(offer), price: Number(offer.price) || 0 });
        continue;
      }
      // «Київ 41» теж закінчується числом: якщо це не товар, вирішимо в кінці, чи це місто й відділення.
      failed.push({ line: tidy(line), error: error ?? "" });
      continue;
    }
    const z = line.match(ZIP);
    if (z && (ukr || /індекс/i.test(z[0]) || !NP_MARK.test(line))) {
      zip ||= z[1];
      ukr = true;
      line = line.replace(z[0], " ");
    }
    if (UKR_WORD.test(line)) {
      // «Укрпошта 1» — номер відділення Укрпошти, він не потрібен: відділення визначає індекс.
      line = line.replace(new RegExp(UKR_WORD.source + /\s*[№#]?\s*\d{0,3}(?!\d)/.source, "i"), " ");
    }
    if (!ukr) {
      const n = line.match(NP_MARK);
      if (n) {
        npNumber ||= n[1] ?? n[2];
        line = line.replace(n[0], " ");
      }
      line = line.replace(NP_WORD, " ");
    }
    line = line.replace(REGION, " ");
    const s = line.match(SETTLEMENT);
    if (s) {
      city ||= s[1];
      line = line.replace(s[0], " ");
    }
    line = line.replace(/індекс|відділення/gi, " ");
    // Рядок без цифр і букв після всього цього — порожній.
    if (words(line).length) {
      // «Київ 25» окремим рядком без жодних позначок — Нова Пошта старим форматом.
      const m = tidy(line).match(/^([^\d]+?)\s+(\d{1,5})$/);
      if (m && !hadPhone && !ukr && !npNumber) { places.push({ city: m[1], number: m[2] }); continue; }
      chunks.push({ text: words(line).join(" "), hadPhone });
    }
  }

  // Рядок «Київ 41», що не виявився товаром, — відділення Нової Пошти, якщо іншої доставки немає.
  if (!ukr && !npNumber && !places.length) {
    const i = failed.findIndex((f) => /^[^\d]+?\s+\d{1,5}$/.test(f.line));
    if (i >= 0) {
      const m = failed[i].line.match(/^([^\d]+?)\s+(\d{1,5})$/)!;
      places.push({ city: m[1], number: m[2] });
      failed.splice(i, 1);
    }
  }
  if (failed.length) return { error: failed[0].error };
  if (!phone) return { error: "Не знайшов телефон. Напишіть номер, наприклад 0671234567." };
  // Імʼя — шматок з телефоном або найдовший; інші короткі шматки — населений пункт.
  const nameChunk = chunks.find((c) => c.hadPhone && words(c.text).length >= 2) ?? [...chunks].sort((a, b) => words(b.text).length - words(a.text).length)[0];
  const others = chunks.filter((c) => c !== nameChunk);
  let nameWords = nameChunk ? words(nameChunk.text) : [];

  let delivery: ManualOrder["delivery"];
  if (ukr) {
    if (!zip) return { error: "Для Укрпошти потрібен індекс з 5 цифр, наприклад «Укрпошта індекс 12101»." };
    if (!city && others.length) city = others[0].text;
    delivery = { service: "ukrposhta", city: cleanCity(city), zip };
  } else {
    let number = npNumber;
    let cityQuery = city;
    if (places.length && !number) {
      number = places[0].number;
      cityQuery ||= places[0].city;
    }
    if (!number) return { error: "Не знайшов доставку. Напишіть місто і номер відділення Нової Пошти («Київ 25») або «Укрпошта індекс 12101»." };
    // Місто без «м.»: беремо інший рядок або перевіряємо слова з імені — чи є таке місто в Новій Пошті.
    const guesses = cityQuery ? [cityQuery] : [...others.map((c) => c.text), ...nameWords.filter((w) => /^[А-ЯІЇЄҐ]/.test(w)).reverse()].slice(0, 5);
    let found: { name: string; ref: string } | undefined;
    for (const g of guesses) {
      const list = await searchCities(cleanCity(g));
      found = list.find((c) => norm(c.name) === norm(cleanCity(g))) ?? (cityQuery ? list[0] : undefined);
      if (found) {
        if (!cityQuery) nameWords = nameWords.filter((w) => norm(w) !== norm(g));
        break;
      }
    }
    if (!found) return { error: cityQuery ? `Нова Пошта не знайшла місто «${cityQuery}».` : "Не зрозумів, яке місто. Напишіть, наприклад, «м. Київ, відділення 25»." };
    const warehouses = await searchWarehouses(found.ref, number);
    const warehouse = warehouses.find((w) => w.number === number);
    if (!warehouse) return { error: `У місті ${found.name} немає відділення чи поштомата №${number}.` };
    delivery = { service: "novaposhta", city: found.name, warehouse: { name: warehouse.name, ref: warehouse.ref } };
  }

  const name = nameWords.join(" ");
  if (!name) return { error: "Не знайшов імʼя отримувача." };
  if (!items.length) return { error: "Не бачу товару: допишіть окремим рядком модель, колір і розмір, наприклад «Olimp чорні 41»." };
  return { order: { name, phone, delivery, items } };
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
