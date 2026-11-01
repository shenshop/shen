import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { request } from "./keycrm";
import { esc, telegram } from "./telegram";
import { sizeChartFor } from "@/data/sizes";
import { SITE_URL } from "./seo";

// Бот для клієнтів (окремий від робочого бота Дрона). Ключ — секрет SHOP_BOT_TOKEN у Cloudflare.
// Клієнт потрапляє в бот кнопкою на сторінці «Дякуємо» (t.me/<бот>?start=o<номер>_<підпис>):
// бот показує замовлення і просить підтвердити розмір, а потім сам надсилає ТТН і нагадування.
// Питання клієнтів бот пересилає Дронові в робочий бот; відповідь «Відповісти» там іде клієнту.

export const shopBotEnabled = () => Boolean(process.env.SHOP_BOT_TOKEN);
const fresh = { cache: "no-store" as const };

export async function shopBot<T = unknown>(method: string, body: object): Promise<{ ok: boolean; result?: T }> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.SHOP_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) console.error(`Shop bot ${method}: ${res.status} ${json.description ?? ""}`);
  return json;
}

async function sha(text: string, bytes: number) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...hash.slice(0, bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const shopWebhookSecret = () => sha(`shen-shop-bot:${process.env.SHOP_BOT_TOKEN}`, 16);
// Підпис у посиланні, щоб ніхто не відкрив чуже замовлення, підставивши інший номер.
const orderSig = (id: number) => sha(`shen-order:${id}:${process.env.SHOP_BOT_TOKEN}`, 5);

// Сховище: замовлення ↔ чат клієнта, і повідомлення Дронові ↔ чат клієнта (для відповідей).
type KV = {
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string }): Promise<{ keys: { name: string }[] }>;
};
const kv = () => (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
const YEAR = 60 * 60 * 24 * 365;
const orderKey = (id: number) => `shopbot:order:${id}`;
const chatKey = (chat: number) => `shopbot:chat:${chat}`;
const relayKey = (msg: number) => `shopbot:relay:${msg}`;
const awaitKey = (chat: number) => `shopbot:await:${chat}`;
// Розмова триває: автовідповідь «Менеджер відповість…» не повторюємо 6 годин після неї або після відповіді Дрона.
const talkKey = (chat: number) => `shopbot:talk:${chat}`;
const TALK_TTL = 60 * 60 * 6;
// Чекаємо відповіді клієнта: якщо мовчить 2+ години, бот один раз перепитує (щогодинний cron).
const silentKey = (chat: number) => `shopbot:silent:${chat}`;
type Silent = { at: number; order?: number };
const expectAnswer = (chat: number, order?: number) =>
  kv().put(silentKey(chat), JSON.stringify({ at: Date.now(), order } satisfies Silent), { expirationTtl: 60 * 60 * 24 });

/** Чат клієнта, який привʼязав це замовлення в боті, або null. */
export async function chatForOrder(id: number) {
  if (!shopBotEnabled()) return null;
  const v = await kv().get(orderKey(id));
  return v ? Number(v) : null;
}

let username: string | null = null;
async function botUsername() {
  if (username) return username;
  const me = await shopBot<{ username: string }>("getMe", {});
  username = me.result?.username ?? null;
  return username;
}

/** Посилання для сторінки «Дякуємо», або null, якщо бот ще не налаштований. */
export async function orderLink(id: number) {
  if (!shopBotEnabled() || !Number.isFinite(id)) return null;
  const name = await botUsername().catch(() => null);
  return name ? `https://t.me/${name}?start=o${id}_${await orderSig(id)}` : null;
}

type KOrder = {
  id: number;
  manager_comment?: string | null;
  buyer?: { full_name?: string | null } | null;
  products?: { name: string; quantity: number; properties?: { name: string; value: string }[] | null }[];
};
const getOrder = (id: number) => request<KOrder>(`/order/${id}?include=products,buyer`, fresh);

async function addComment(id: number, note: string) {
  const order = await request<{ manager_comment?: string | null }>(`/order/${id}`, fresh);
  const manager_comment = [order.manager_comment?.trim(), note].filter(Boolean).join("\n");
  await request(`/order/${id}`, { method: "PUT", body: JSON.stringify({ manager_comment }), ...fresh });
}

const sizeOf = (p: { properties?: { name: string; value: string }[] | null }) =>
  p.properties?.find((x) => /розмір|size/i.test(x.name))?.value?.trim() ?? "";
function itemLine(p: NonNullable<KOrder["products"]>[number]) {
  const size = sizeOf(p);
  const insole = size ? sizeChartFor(p.name)[size] : undefined;
  return `👟 ${esc(p.name)}${size ? `, розмір <b>${esc(size)}</b>` : ""}${insole ? ` (устілка ${insole} см)` : ""}${p.quantity > 1 ? ` × ${p.quantity}` : ""}`;
}
const firstName = (o: KOrder) => o.buyer?.full_name?.trim().split(/\s+/).slice(1, 2)[0] || o.buyer?.full_name?.trim().split(/\s+/)[0] || "";

const CATALOG = { inline_keyboard: [[{ text: "🛒 Каталог взуття", url: `${SITE_URL}/catalog` }]] };
const WELCOME =
  "Вітаємо в SHEN! 👟\n\nТут можна:\n• підтвердити розмір замовлення\n• отримати номер ТТН, щойно посилку відправлять\n• поставити будь-яке питання про взуття\n\nНапишіть, що вас цікавить, і ми відповімо найближчим часом.";

type Message = { message_id: number; chat: { id: number }; from?: { first_name?: string; last_name?: string; username?: string }; text?: string; caption?: string; photo?: unknown[] };
type Update = { message?: Message; callback_query?: { id: string; data?: string; from: { id: number }; message?: Message } };

const sizeButtons = (id: number) => ({
  inline_keyboard: [[{ text: "✅ Так, все вірно", callback_data: `ok:${id}` }, { text: "🔄 Інший розмір", callback_data: `chg:${id}` }]],
});

export async function handleShopUpdate(update: Update) {
  const cb = update.callback_query;
  const from = cb?.message?.chat.id ?? update.message?.chat.id;
  if (from) await kv().delete(silentKey(from));
  if (cb?.message) {
    await shopBot("answerCallbackQuery", { callback_query_id: cb.id });
    const chat = cb.message.chat.id;
    const m = cb.data?.match(/^(ok|chg):(\d+)$/);
    if (!m) return;
    const id = Number(m[2]);
    // Кнопки працюють лише в чаті, який привʼязав це замовлення.
    if ((await chatForOrder(id)) !== chat) return;
    await shopBot("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    const order = await getOrder(id);
    const sizes = (order.products ?? []).map(sizeOf).filter(Boolean).join(", ");
    if (m[1] === "ok") {
      await addComment(id, `Розмір підтверджено клієнтом у Telegram (${sizes})`);
      await shopBot("sendMessage", { chat_id: chat, text: "Дякуємо! Розмір підтверджено ✅\nНомер ТТН надішлемо сюди, щойно посилку відправимо." });
      await telegram("sendMessage", { text: `✅ №${id}${order.buyer?.full_name ? ` · ${esc(order.buyer.full_name)}` : ""}: клієнт підтвердив розмір ${esc(sizes)} у Telegram.`, parse_mode: "HTML" });
    } else {
      await kv().put(awaitKey(chat), String(id), { expirationTtl: 60 * 60 * 24 * 3 });
      await shopBot("sendMessage", { chat_id: chat, text: "Напишіть, будь ласка, який розмір потрібен, або довжину стопи в сантиметрах — підберемо 🙌" });
      await expectAnswer(chat);
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chat = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();

  // /start o3035_ab12cd — клієнт прийшов зі сторінки «Дякуємо».
  const start = text.match(/^\/start(?:\s+o(\d+)_([0-9a-f]+))?/);
  if (start) {
    if (start[1] && start[2] === (await orderSig(Number(start[1])))) {
      const id = Number(start[1]);
      await kv().put(orderKey(id), String(chat), { expirationTtl: YEAR });
      const prev = JSON.parse((await kv().get(chatKey(chat))) ?? "[]") as number[];
      await kv().put(chatKey(chat), JSON.stringify([...new Set([...prev, id])].slice(-10)), { expirationTtl: YEAR });
      const order = await getOrder(id);
      const name = firstName(order);
      await shopBot("sendMessage", {
        chat_id: chat,
        parse_mode: "HTML",
        text: [
          `${name ? `${esc(name)}, д` : "Д"}якуємо за замовлення №${id}! 🙌`,
          "",
          ...(order.products ?? []).map(itemLine),
          "",
          "Перевірте, будь ласка, розмір. Все вірно?",
        ].join("\n"),
        reply_markup: sizeButtons(id),
      });
      await expectAnswer(chat, id);
      return;
    }
    await shopBot("sendMessage", { chat_id: chat, text: WELCOME, reply_markup: CATALOG });
    return;
  }

  // Будь-яке інше повідомлення — Дронові в робочий бот. Відповідь «Відповісти» там піде клієнту.
  const orders = JSON.parse((await kv().get(chatKey(chat))) ?? "[]") as number[];
  const waitingSize = await kv().get(awaitKey(chat));
  const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") + (msg.from?.username ? ` @${msg.from.username}` : "");
  const head = waitingSize
    ? `🔄 <b>№${waitingSize}: клієнт хоче інший розмір</b>`
    : `💬 <b>Питання від клієнта</b>${orders.length ? ` (замовлення ${orders.map((o) => `№${o}`).join(", ")})` : ""}`;
  const body = text ? `«${esc(text.slice(0, 3000))}»` : msg.photo ? "[надіслав фото — відкрийте бот SHEN, щоб побачити]" : "[повідомлення без тексту]";
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      parse_mode: "HTML",
      text: `${head}\n👤 ${esc(who || "без імені")}\n\n${body}\n\n↩️ Щоб відповісти, натисніть «Відповісти» на цьому повідомленні.`,
    }),
  });
  const sent = (await res.json().catch(() => ({}))) as { result?: { message_id: number } };
  if (sent.result) await kv().put(relayKey(sent.result.message_id), String(chat), { expirationTtl: 60 * 60 * 24 * 30 });
  if (waitingSize) {
    await kv().delete(awaitKey(chat));
    await addComment(Number(waitingSize), `Клієнт у Telegram просить інший розмір: ${text.slice(0, 300)}`).catch(console.error);
    await shopBot("sendMessage", { chat_id: chat, text: "Дякуємо! Передали менеджеру, він уточнить і змінить розмір у замовленні 👌" });
  } else if (!(await kv().get(talkKey(chat)))) {
    await shopBot("sendMessage", { chat_id: chat, text: "Дякуємо! Менеджер відповість тут найближчим часом 🙌" });
    await kv().put(talkKey(chat), "1", { expirationTtl: TALK_TTL });
  }
}

/** Відповідь Дрона (через «Відповісти» в робочому боті) на питання клієнта. true — це була відповідь клієнту. */
export async function relayOwnerReply(replyToMessageId: number | undefined, text: string) {
  if (!replyToMessageId || !shopBotEnabled() || !text) return false;
  const chat = await kv().get(relayKey(replyToMessageId));
  if (!chat) return false;
  const ok = (await shopBot("sendMessage", { chat_id: Number(chat), text })).ok;
  if (ok) await kv().put(talkKey(Number(chat)), "1", { expirationTtl: TALK_TTL });
  // Перепитуємо лише якщо Дрон щось запитав, а не на «Дякуємо, гарного дня».
  if (ok && text.includes("?")) await expectAnswer(Number(chat));
  await telegram("sendMessage", { text: ok ? "✉️ Надіслано клієнту в Telegram." : "⚠️ Не вдалося надіслати: клієнт, мабуть, зупинив бот. Напишіть йому у Viber." });
  return true;
}

/** Надіслати клієнту повідомлення в бот, якщо він привʼязав замовлення. true — надіслано. */
export async function notifyOrderChat(orderId: number, text: string) {
  const chat = await chatForOrder(orderId);
  if (!chat) return false;
  return (await shopBot("sendMessage", { chat_id: chat, text, link_preview_options: { is_disabled: true } })).ok;
}

export async function setupShopBot(origin: string) {
  const webhook = await shopBot("setWebhook", {
    url: `${origin}/api/shop-bot`,
    secret_token: await shopWebhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  await shopBot("setMyDescription", {
    description:
      "Вітаємо в SHEN — шкіряне взуття з доставкою по Україні 👟\n\nТут можна:\n• підтвердити розмір замовлення\n• отримати номер ТТН\n• поставити будь-яке питання\n\nНатисніть «Розпочати» 👇",
  });
  await shopBot("setMyShortDescription", { short_description: "SHEN — шкіряне взуття. Розмір, ТТН і питання про замовлення." });
  await shopBot("setChatMenuButton", { menu_button: { type: "web_app", text: "Каталог", web_app: { url: `${SITE_URL}/catalog` } } });
  return { ok: webhook.ok, username: await botUsername() };
}

/** Щогодини: клієнтам, які мовчать 2+ години після нашого питання, бот один раз нагадує. Вночі не турбуємо. */
export async function remindSilent() {
  if (!shopBotEnabled()) return 0;
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Kyiv", hour: "numeric", hour12: false }));
  if (hour < 9 || hour >= 21) return 0;
  let sent = 0;
  for (const { name } of (await kv().list({ prefix: "shopbot:silent:" })).keys) {
    const raw = await kv().get(name);
    if (!raw) continue;
    const w = JSON.parse(raw) as Silent;
    if (Date.now() - w.at < 2 * 60 * 60 * 1000) continue;
    const chat = Number(name.slice("shopbot:silent:".length));
    await kv().delete(name);
    const res = w.order
      ? await shopBot("sendMessage", {
          chat_id: chat,
          text: `Нагадуємо 🙂 Підтвердіть, будь ласка, розмір для замовлення №${w.order}, щоб ми його відправили.`,
          reply_markup: sizeButtons(w.order),
        })
      : await shopBot("sendMessage", { chat_id: chat, text: "Ви бачили наше повідомлення вище? 🙂 Напишіть, будь ласка, як вам зручно." });
    if (res.ok) sent++;
  }
  return sent;
}
