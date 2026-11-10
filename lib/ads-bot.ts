import "server-only";
import { esc } from "./telegram";

// Бот для реклами (окремий від робочого бота). Секрети в Cloudflare: ADS_BOT_TOKEN (від @BotFather)
// і META_TOKEN (токен системного користувача Meta з дозволами ads_read та ads_management).
// Відповідає лише Дронові (TELEGRAM_CHAT_ID). Показує статистику кампаній, щоранку надсилає звіт
// і міняє бюджет або вимикає кампанію лише після кнопки «✅ Так». Кнопка «💳 Баланс» — гроші на рекламному акаунті.

const ACCOUNT = "act_814873905794399";
const GRAPH = "https://graph.facebook.com/v24.0";
// Правило ціни за покупку (як домовились з Дроном): до 8 $ — масштабуємо, 8–12 — дивимось, понад 12 — вимикаємо.
const GOOD = 8;
const BAD = 12;
// Скільки витрат без жодної покупки вважаємо сигналом вимкнути кампанію.
const NO_SALES_LIMIT = 30;

export const adsBotEnabled = () => Boolean(process.env.ADS_BOT_TOKEN && process.env.META_TOKEN);

export async function adsBot<T = unknown>(method: string, body: object): Promise<{ ok: boolean; result?: T }> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.ADS_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) console.error(`Ads bot ${method}: ${res.status} ${json.description ?? ""}`);
  return json;
}

// Telegram приймає до 4096 символів, тому довгий текст ділимо по порожніх рядках.
async function send(text: string, extra: object = {}) {
  const parts: string[] = [];
  let cur = "";
  for (const block of text.split("\n\n")) {
    if (cur && cur.length + block.length + 2 > 3800) {
      parts.push(cur);
      cur = block;
    } else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) parts.push(cur);
  let last: Awaited<ReturnType<typeof adsBot>> = { ok: false };
  for (const part of parts) {
    last = await adsBot("sendMessage", { chat_id: process.env.TELEGRAM_CHAT_ID, text: part, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  }
  return last;
}

export async function adsWebhookSecret() {
  const data = new TextEncoder().encode(`shen-ads-bot:${process.env.ADS_BOT_TOKEN}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Meta Marketing API ----------

async function meta<T>(path: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const q = new URLSearchParams({ ...params, access_token: process.env.META_TOKEN ?? "" });
  const res =
    method === "GET"
      ? await fetch(`${GRAPH}/${path}?${q}`, { cache: "no-store" })
      : await fetch(`${GRAPH}/${path}`, { method: "POST", body: q });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`Meta: ${json.error?.message ?? res.status}`);
  return json;
}

type Campaign = { id: string; name: string; daily_budget?: string; effective_status: string };
type Action = { action_type: string; value: string };
type Insight = { campaign_id: string; campaign_name: string; spend: string; actions?: Action[] };

// Увімкнені кампанії, які реально крутяться: була витрата сьогодні або за 7 днів.
// Старі кампанії зі статусом «активна», але без живих груп оголошень, не показуємо (їх багато,
// і через них повідомлення ставало задовгим для Telegram).
async function activeCampaigns() {
  const [r, today, week] = await Promise.all([
    meta<{ data: Campaign[] }>(`${ACCOUNT}/campaigns`, {
      fields: "id,name,daily_budget,effective_status",
      effective_status: JSON.stringify(["ACTIVE", "IN_PROCESS", "WITH_ISSUES"]),
      limit: "200",
    }),
    insights("today"),
    insights("last_7d"),
  ]);
  const spent = new Set([...today, ...week].filter((s) => Number(s.spend) > 0).map((s) => s.campaign_id));
  return r.data.filter((c) => spent.has(c.id));
}

// Покупки з пікселя сайту. Meta може назвати їх по-різному, беремо першу знайдену назву.
const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];
function purchases(actions: Action[] = []) {
  for (const type of PURCHASE) {
    const a = actions.find((x) => x.action_type === type);
    if (a) return Number(a.value);
  }
  return 0;
}

export type Period = "today" | "yesterday" | "last_3d" | "last_7d";
const PERIOD_NAME: Record<Period, string> = {
  today: "Сьогодні",
  yesterday: "Вчора",
  last_3d: "3 дні",
  last_7d: "7 днів",
};

async function insights(period: Period) {
  const r = await meta<{ data: Insight[] }>(`${ACCOUNT}/insights`, {
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,actions",
    date_preset: period,
    limit: "200",
  });
  return r.data;
}

type Row = { id: string; name: string; spend: number; buys: number; budget: number | null };

async function rows(period: Period): Promise<Row[]> {
  const [camps, stats] = await Promise.all([activeCampaigns(), insights(period)]);
  const byId = new Map(stats.map((s) => [s.campaign_id, s]));
  const list: Row[] = camps.map((c) => {
    const s = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      spend: s ? Number(s.spend) : 0,
      buys: s ? purchases(s.actions) : 0,
      budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
    };
  });
  return list.sort((a, b) => b.spend - a.spend);
}

const usd = (n: number) => `${n.toFixed(2).replace(".", ",")} $`;

function verdict(r: Row) {
  if (r.buys === 0) return r.spend >= NO_SALES_LIMIT ? "🔴" : "⚪";
  const cpa = r.spend / r.buys;
  return cpa < GOOD ? "🟢" : cpa <= BAD ? "🟡" : "🔴";
}

// Стисло: одна кампанія — один рядок «🟢 назва — витрата · покупки · ціна покупки».
const short = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);
const usd0 = (n: number) => `${n.toFixed(n >= 100 ? 0 : 1).replace(".", ",")}$`;

function line(r: Row) {
  const cpa = r.buys ? ` · ${usd0(r.spend / r.buys)}` : "";
  return `${verdict(r)} ${esc(short(r.name))} — ${usd0(r.spend)} · ${r.buys} пок${cpa}`;
}

export async function report(period: Period) {
  const list = await rows(period);
  const spend = list.reduce((s, r) => s + r.spend, 0);
  const buys = list.reduce((s, r) => s + r.buys, 0);
  const head = `📊 <b>${PERIOD_NAME[period]}</b>: ${usd0(spend)} · ${buys} пок${buys ? ` · ${usd0(spend / buys)}` : ""}`;
  if (!list.length) return `${head}\nАктивних кампаній немає.`;
  return `${head}\n${list.map(line).join("\n")}`;
}

/** Підказки за останні 3 дні: що підняти, що вимкнути. */
async function advice() {
  const list = await rows("last_3d");
  const up = list.filter((r) => r.buys >= 3 && r.spend / r.buys < GOOD);
  const down = list.filter((r) => (r.buys === 0 && r.spend >= NO_SALES_LIMIT) || (r.buys > 0 && r.spend / r.buys > BAD));
  const out: string[] = [];
  if (up.length) out.push(`💡 Можна підняти бюджет на 20%: ${up.map((r) => esc(r.name)).join(", ")}`);
  if (down.length) out.push(`⚠️ Варто вимкнути або змінити відео: ${down.map((r) => esc(r.name)).join(", ")}`);
  return out.join("\n");
}

// Баланс рекламного акаунта. Для передоплаченого акаунта Meta показує залишок у funding_source_details
// (напр. «Доступний баланс (12,34 USD)»); для оплати карткою — суму, яку ще спишуть (balance).
type Account = {
  name: string;
  currency: string;
  amount_spent: string;
  balance: string;
  spend_cap?: string;
  is_prepay_account?: boolean;
  funding_source_details?: { display_string?: string };
};

export async function balance() {
  const [a, camps] = await Promise.all([
    meta<Account>(ACCOUNT, {
      fields: "name,currency,amount_spent,balance,spend_cap,is_prepay_account,funding_source_details",
    }),
    activeCampaigns(),
  ]);
  const cur = a.currency === "USD" ? "$" : ` ${a.currency}`;
  const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")}${cur}`;
  const perDay = camps.reduce((s, c) => s + (c.daily_budget ? Number(c.daily_budget) : 0), 0);
  const out = [`💳 <b>Рекламний акаунт</b> ${esc(a.name)}`];
  if (a.funding_source_details?.display_string) out.push(`Спосіб оплати: ${esc(a.funding_source_details.display_string)}`);
  // Прогноз «вистачить на N днів» для передоплати: беремо число з рядка «Доступний баланс (…)».
  const prepaid = a.is_prepay_account ? a.funding_source_details?.display_string?.match(/([\d\s.,]+)\s*[A-Z]{3}/) : null;
  if (prepaid && perDay > 0) {
    const left = Number(prepaid[1].replace(/\s/g, "").replace(",", ".")) * 100;
    if (Number.isFinite(left)) out.push(`Залишку вистачить приблизно на ${Math.floor(left / perDay)} дн.`);
  }
  if (!a.is_prepay_account) out.push(`Нараховано до списання з картки: ${money(Number(a.balance))}`);
  if (a.spend_cap && Number(a.spend_cap) > 0) {
    out.push(`Ліміт витрат акаунта: ${money(Number(a.spend_cap))}, залишилось ${money(Number(a.spend_cap) - Number(a.amount_spent))}`);
  }
  out.push(`Активні бюджети разом: ${money(perDay)} на день`);
  return out.join("\n");
}

// ---------- Telegram ----------

const KEYBOARD = {
  keyboard: [
    [{ text: "📊 Сьогодні" }, { text: "📈 Вчора" }],
    [{ text: "📅 3 дні" }, { text: "📆 7 днів" }],
    [{ text: "💰 Бюджети" }, { text: "💡 Поради" }, { text: "💳 Баланс" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const BUTTONS: Record<string, Period> = {
  "📊 Сьогодні": "today",
  "📈 Вчора": "yesterday",
  "📅 3 дні": "last_3d",
  "📆 7 днів": "last_7d",
};

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

const owner = (chat?: number) => chat != null && String(chat) === process.env.TELEGRAM_CHAT_ID;

export async function handleAdsUpdate(u: Update) {
  if (u.callback_query) return handleCallback(u.callback_query);
  const msg = u.message;
  if (!msg || !owner(msg.chat.id)) return;
  const text = (msg.text ?? "").trim();
  try {
    if (Object.hasOwn(BUTTONS, text)) await send(await report(BUTTONS[text]), { reply_markup: KEYBOARD });
    else if (text === "💰 Бюджети") await budgetList();
    else if (text === "💳 Баланс") await send(await balance(), { reply_markup: KEYBOARD });
    else if (text === "💡 Поради") await send((await advice()) || "За останні 3 дні все в нормі, нічого міняти не треба.", { reply_markup: KEYBOARD });
    else await send("Оберіть кнопку внизу 👇", { reply_markup: KEYBOARD });
  } catch (e) {
    await send(`⚠️ ${esc(String(e instanceof Error ? e.message : e)).slice(0, 400)}`, { reply_markup: KEYBOARD });
  }
}

async function budgetList() {
  const list = await rows("last_3d");
  if (!list.length) return send("Активних кампаній немає.", { reply_markup: KEYBOARD });
  await send("💰 Яку кампанію змінити? (ціна за покупку за 3 дні)", {
    reply_markup: {
      inline_keyboard: list.map((r) => [
        {
          text: `${verdict(r)} ${r.name} · ${r.budget != null ? usd(r.budget) : "бюджет групи"} · ${r.buys ? usd(r.spend / r.buys) : "—"}`,
          callback_data: `c:${r.id}`,
        },
      ]),
    },
  });
}

async function handleCallback(q: NonNullable<Update["callback_query"]>) {
  await adsBot("answerCallbackQuery", { callback_query_id: q.id });
  const chat = q.message?.chat.id;
  if (!owner(chat) || !q.data || !q.message) return;
  const edit = (text: string, keyboard?: object[][]) =>
    adsBot("editMessageText", {
      chat_id: chat,
      message_id: q.message!.message_id,
      text,
      parse_mode: "HTML",
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    });
  const [kind, id, value] = q.data.split(":");
  try {
    const c = await meta<Campaign>(id, { fields: "id,name,daily_budget,effective_status" });
    const name = esc(c.name);
    const budget = c.daily_budget ? Number(c.daily_budget) / 100 : null;

    if (kind === "c") {
      // Крок 1: що зробити з кампанією.
      const options: object[][] = [];
      if (budget != null) {
        const step = (k: number) => Math.round(budget * k);
        options.push([
          { text: `−20% → ${step(0.8)} $`, callback_data: `a:${id}:${step(0.8) * 100}` },
          { text: `+20% → ${step(1.2)} $`, callback_data: `a:${id}:${step(1.2) * 100}` },
          { text: `+30% → ${step(1.3)} $`, callback_data: `a:${id}:${step(1.3) * 100}` },
        ]);
      }
      options.push([{ text: "⏸ Вимкнути", callback_data: `a:${id}:off` }]);
      options.push([{ text: "✖️ Скасувати", callback_data: `x:${id}` }]);
      const now = budget != null ? `зараз ${usd(budget)}/день` : "бюджет задано на рівні групи, тут можна лише вимкнути";
      return edit(`<b>${name}</b>\n${now}`, options);
    }

    if (kind === "a") {
      // Крок 2: перепитуємо, нічого ще не змінено.
      const what = value === "off" ? "вимкнути кампанію" : `змінити бюджет ${budget != null ? usd(budget) : ""} → ${usd(Number(value) / 100)}/день`;
      return edit(`<b>${name}</b>\nТочно ${what}?`, [
        [
          { text: "✅ Так", callback_data: `ok:${id}:${value}` },
          { text: "✖️ Ні", callback_data: `x:${id}` },
        ],
      ]);
    }

    if (kind === "ok") {
      if (value === "off") {
        await meta(id, { status: "PAUSED" }, "POST");
        return edit(`⏸ <b>${name}</b> вимкнено.`);
      }
      const cents = Number(value);
      if (!Number.isFinite(cents) || cents < 100) return edit("Неправильна сума, нічого не змінено.");
      await meta(id, { daily_budget: String(cents) }, "POST");
      return edit(`✅ <b>${name}</b>: бюджет тепер ${usd(cents / 100)}/день.`);
    }

    if (kind === "x") return edit(`<b>${name}</b>: нічого не змінено.`);
  } catch (e) {
    await edit(`⚠️ ${esc(String(e instanceof Error ? e.message : e)).slice(0, 400)}\nНічого не змінено.`);
  }
}

/** Щоранку о 10:00 (разом з іншими щоденними перевірками): звіт за вчора і поради за 3 дні. */
export async function dailyAdsReport() {
  if (!adsBotEnabled()) return;
  const tips = await advice();
  await send(`${await report("yesterday")}${tips ? `\n\n${tips}` : ""}`, { reply_markup: KEYBOARD });
}

export async function setupAdsBot(origin: string) {
  const webhook = await adsBot("setWebhook", {
    url: `${origin}/api/ads-bot`,
    secret_token: await adsWebhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  // Перевіряємо токен Meta одразу, щоб помилку було видно тут, а не в боті.
  const check = await meta<{ name: string }>(ACCOUNT, { fields: "name" }).then(
    (a) => `OK: ${a.name}`,
    (e) => String(e instanceof Error ? e.message : e),
  );
  if (webhook.ok) await send("Бот реклами підключено ✅ Оберіть кнопку внизу 👇", { reply_markup: KEYBOARD });
  return { ok: webhook.ok, meta: check };
}
