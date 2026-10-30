import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { request } from "./keycrm";

// Новий товар у KeyCRM з повідомлення в боті. Дрон надсилає фото альбомом, а в підписі:
//   Чоловічі кеди зимові шнурок резинка   ← назва (перший рядок)
//   Артикул 135
//   Розміри 40-45                          ← або 36, 37, 38
//   Ціна 3200
//   Закупка 1600                           ← необовʼязково
//   Категорія Черевики                     ← необовʼязково
//   решта рядків іде в опис
// Нічого не створюємо, поки Дрон не натисне «Створити» під перевіркою.

const fresh = { cache: "no-store" as const };
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ON_SITE_FIELD = "CT_1006";

export type NewProduct = {
  name: string;
  sku: string;
  sizes: string[];
  price: number;
  purchasedPrice?: number;
  category?: { id: number; name: string };
  description: string;
};

/** Схоже на новий товар: є рядки «Артикул …» і «Розміри …». */
export const looksLikeProduct = (text: string) => /^\s*артикул[\s:]/im.test(text) && /^\s*розмір/im.test(text);

const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

function parseSizes(s: string): string[] {
  const range = s.match(/^(\d{2})\s*[-–—]\s*(\d{2})$/);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (from > to || to - from > 15) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
  }
  return s.replace(/(\d{2}),5\b/g, "$1.5").split(/[,;\s]+/).filter((x) => /^\d{2}(\.5)?$/.test(x));
}

export async function parseNewProduct(text: string): Promise<{ product?: NewProduct; error?: string }> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let sku = "", sizes: string[] = [], price = 0, purchasedPrice: number | undefined, categoryName = "";
  const rest: string[] = [];
  for (const l of lines) {
    const m = l.match(/^(артикул|розміри?|ціна|закупка|закупівельна ціна|собівартість|категорія)\s*[:\-–]?\s*(.+)$/i);
    if (!m) { rest.push(l); continue; }
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "артикул") sku = value;
    else if (key.startsWith("розмір")) sizes = parseSizes(value.replace(/\s*(повномір\S*|маломір\S*|великомір\S*)\s*$/i, "").trim());
    else if (key === "ціна") price = num(value.replace(/\s*(грн|₴)\.?$/i, ""));
    else if (key === "категорія") categoryName = value;
    else purchasedPrice = num(value.replace(/\s*(грн|₴)\.?$/i, ""));
    // «Розміри 40-45 Повномірки»: примітку про посадку лишаємо в описі.
    const fit = key.startsWith("розмір") ? value.match(/(повномір\S*|маломір\S*|великомір\S*)/i) : null;
    if (fit) rest.push(fit[1].charAt(0).toUpperCase() + fit[1].slice(1));
  }
  const [name, ...description] = rest;
  if (!name) return { error: "Напишіть назву товару першим рядком." };
  if (!sku) return { error: "Не бачу рядка «Артикул 135»." };
  if (!sizes.length) return { error: "Не розібрав розміри. Напишіть, наприклад, «Розміри 40-45» або «Розміри 36, 37, 38»." };
  if (!(price > 0)) return { error: "Не бачу ціни. Додайте рядок «Ціна 3200»." };
  if (purchasedPrice !== undefined && !(purchasedPrice > 0)) return { error: "Не розібрав закупівельну ціну." };

  let category: NewProduct["category"];
  if (categoryName) {
    const list = rows(await request<List<{ id: number; name: string }>>("/products/categories?limit=50", fresh));
    const found = list.find((c) => norm(c.name) === norm(categoryName));
    if (!found) return { error: `У KeyCRM немає категорії «${categoryName}». Є: ${list.map((c) => c.name).join(", ")}.` };
    category = { id: found.id, name: found.name };
  }

  // Артикули розмірів «135-40» не повинні вже бути в каталозі, інакше вийде дубль.
  const taken = rows(await request<List<{ sku: string }>>(`/offers?filter[sku]=${encodeURIComponent(`${sku}-${sizes[0]}`)}&limit=5`, fresh));
  if (taken.some((o) => norm(o.sku) === norm(`${sku}-${sizes[0]}`))) {
    return { error: `Артикул «${sku}-${sizes[0]}» вже є в KeyCRM. Можливо, цей товар уже додано.` };
  }

  return { product: { name, sku, sizes, price, purchasedPrice, category, description: description.join("\n") } };
}

// Фото з Telegram: зберігаємо file_id кожного фото альбому окремим ключем, бо фото альбому
// приходять окремими запитами майже одночасно, і спільний список перезаписував би сам себе.
type KV = {
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  list(opts: { prefix: string }): Promise<{ keys: { name: string }[] }>;
};
const kv = () => (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
const photoKey = (group: string, messageId: number) => `tg-newproduct:${group}:${String(messageId).padStart(12, "0")}`;

export async function rememberPhoto(group: string, messageId: number, fileId: string) {
  await kv().put(photoKey(group, messageId), fileId, { expirationTtl: 60 * 60 * 24 * 3 });
}

export async function groupPhotos(group: string): Promise<string[]> {
  const { keys } = await kv().list({ prefix: `tg-newproduct:${group}:` });
  const ids = await Promise.all(keys.sort((a, b) => a.name.localeCompare(b.name)).map((k) => kv().get(k.name)));
  return ids.filter((x): x is string => Boolean(x)).slice(0, 10);
}

// Підпис для посилання на фото, щоб наш сайт не віддавав будь-які файли бота за чужим запитом.
export async function photoSignature(fileId: string) {
  const data = new TextEncoder().encode(`shen-photo:${process.env.TELEGRAM_BOT_TOKEN}:${fileId}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function photoUrl(origin: string, fileId: string) {
  return `${origin}/api/telegram/photo/${encodeURIComponent(fileId)}.jpg?s=${await photoSignature(fileId)}`;
}

type KOffer = { id: number; sku: string; properties?: { name: string; value: string }[] | null };

export async function createNewProduct(p: NewProduct, pictures: string[]) {
  const created = await request<{ id: number }>("/products", {
    method: "POST",
    ...fresh,
    body: JSON.stringify({
      name: p.name,
      description: p.description.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join(""),
      sku: p.sku,
      price: p.price,
      purchased_price: p.purchasedPrice,
      currency_code: "UAH",
      category_id: p.category?.id,
      pictures,
      custom_fields: [{ uuid: ON_SITE_FIELD, value: true }],
    }),
  });

  const variant = (size: string) => ({
    sku: `${p.sku}-${size}`,
    price: p.price,
    purchased_price: p.purchasedPrice,
    properties: [{ name: "Розмір", value: size }],
  });
  // KeyCRM сам створює одну пропозицію без розміру; робимо з неї перший розмір, щоб не лишилась зайва.
  const existing = rows(await request<List<KOffer>>(`/offers?filter[product_id]=${created.id}&limit=50`, fresh));
  const blank = existing.find((o) => !o.properties?.length);
  const sizes = [...p.sizes];
  if (blank) {
    await request(`/offers/${blank.id}`, { method: "PUT", ...fresh, body: JSON.stringify(variant(sizes.shift()!)) });
  }
  if (sizes.length) {
    await request("/offers", { method: "POST", ...fresh, body: JSON.stringify({ product_id: created.id, offers: sizes.map(variant) }) });
  }

  // Перечитуємо, щоб показати Дрону, що справді збереглося.
  const saved = await request<{ id: number; attachments_data?: string[] | null; custom_fields?: { uuid?: string; value?: unknown }[] }>(
    `/products/${created.id}?include=custom_fields`,
    fresh,
  );
  const offers = rows(await request<List<KOffer>>(`/offers?filter[product_id]=${created.id}&limit=50`, fresh));
  const onSite = saved.custom_fields?.find((f) => f.uuid === ON_SITE_FIELD)?.value;
  return {
    id: created.id,
    photos: saved.attachments_data?.length ?? 0,
    sizes: offers.filter((o) => o.properties?.length).map((o) => o.properties![0].value),
    onSite: onSite != null && onSite !== false && onSite !== 0 && onSite !== "0" && onSite !== "",
  };
}
