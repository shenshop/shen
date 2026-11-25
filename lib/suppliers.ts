import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { esc, telegram } from "./telegram";

// Розрахунки з постачальниками: прихід товару, оплати і борг. KeyCRM такого не вміє,
// тому записи лежать у сховищі Cloudflare (KV сайту) одним документом.

type KV = { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
const kv = () => (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
const KEY = "suppliers:v1";

export type Kind = "in" | "pay" | "start";
export type Cur = "UAH" | "USD";
export type Entry = { id: number; date: string; kind: Kind; sum: number; note: string; cur?: Cur };
export type Supplier = { id: number; name: string; entries: Entry[] };
type Book = { next: number; suppliers: Supplier[] };

export const SUPPLIERS_BUTTON = "🧾 Постачальники";

async function load(): Promise<Book> {
  const raw = await kv().get(KEY);
  return raw ? (JSON.parse(raw) as Book) : { next: 1, suppliers: [] };
}
const save = (b: Book) => kv().put(KEY, JSON.stringify(b));

const today = () => new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });
const CUR_SIGN: Record<Cur, string> = { UAH: "грн", USD: "$" };
const money = (n: number, cur: Cur = "UAH") =>
  `${(Math.round(n * 100) / 100).toLocaleString("uk-UA", { maximumFractionDigits: 2 }).replace(/\s/g, " ")} ${CUR_SIGN[cur]}`;
type Totals = Record<Cur, number>;
const sign = (e: Entry) => (e.kind === "pay" ? -e.sum : e.sum);
// Борг рахуємо окремо в гривнях і в доларах, не змішуючи.
export function debt(s: Supplier, more: Totals = { UAH: 0, USD: 0 }): Totals {
  const t = { ...more };
  for (const e of s.entries) t[e.cur ?? "UAH"] += sign(e);
  return t;
}
const addT = (a: Totals, b: Totals): Totals => ({ UAH: a.UAH + b.UAH, USD: a.USD + b.USD });
const moneyT = (t: Totals) => {
  const parts = (["USD", "UAH"] as Cur[]).filter((c) => Math.abs(t[c]) > 0.004).map((c) => money(t[c], c));
  return parts.length ? parts.join(" + ") : "0";
};
// Для сортування: долари приблизно в гривнях.
const weight = (t: Totals) => t.UAH + t.USD * 42;
const KIND_WORD: Record<Kind, string> = { in: "Прихід", pay: "Оплата", start: "Борг на початок" };

// «Прихід Іван cypress 10 пар 19500», «Оплата Іван 10000», «Борг Іван 25000» (борг, який уже був).
const RE = /^\s*(прих[іi]д товару|прих[іi]д|взяв|оплата|оплатив|заплатив|борг)\s+(.+?)\s+(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)((?:[.,]\d{1,2})?)\s*(грн\.?|гривень|\$|дол\.?|долар[а-яіїє]*|usd|у\.?\s?о\.?)?\s*$/is;

export type Draft = { kind: Kind; name: string; note: string; sum: number; cur: Cur };

// Ім'я можна писати і перед словом: «Яворський оплатив 500$» = «Оплатив Яворський 500$».
const KW = /^\s*(прих[іi]д товару|прих[іi]д|взяв|оплата|оплатив|заплатив|борг)\s/i;
const NAME_FIRST = /^\s*(\S+)\s+(прих[іi]д товару|прих[іi]д|взяв|оплата|оплатив|заплатив|борг)\s+(.+)$/is;
const normalize = (text: string) => (KW.test(text) ? text : text.replace(NAME_FIRST, "$2 $1 $3"));

export function parseSupplierEntry(text: string, known: string[] = []): Draft | null {
  const m = normalize(text).match(RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const kind: Kind = word.startsWith("опла") || word.startsWith("запла") ? "pay" : word === "борг" ? "start" : "in";
  const sum = Number(m[3].replace(/[\s\u00a0]/g, "") + (m[4] ? "." + m[4].slice(1) : ""));
  const cur: Cur = m[5] && !/^(грн|гривень)/i.test(m[5]) ? "USD" : "UAH";
  if (!(sum > 0)) return null;
  let rest = m[2].trim();
  // Імʼя постачальника: найдовше відоме імʼя на початку, інакше перше слово.
  const hit = known
    .filter((n) => rest.toLowerCase() === n.toLowerCase() || rest.toLowerCase().startsWith(n.toLowerCase() + " "))
    .sort((a, b) => b.length - a.length)[0];
  const name = hit ?? rest.split(/\s+/)[0];
  rest = rest.slice(name.length).trim();
  return { kind, name, note: rest, sum, cur };
}

export function looksLikeSupplierEntry(text: string) {
  return (KW.test(text) || NAME_FIRST.test(text)) && !/\d{9,}/.test(text.replace(/[\s()+-]/g, ""));
}

function find(b: Book, name: string) {
  return b.suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

// «Оплатив 500$» без імені: бот питає, кому, кнопками з постачальниками.
const NO_NAME = new RegExp(KW.source + "\\s*(\\d[\\d \\u00a0.,]*)\\s*(грн\\.?|гривень|\\$|дол\\.?|долар[а-яіїє]*|usd)?\\s*$", "i");
const withName = (text: string, name: string) => text.replace(KW, (m) => `${m.trimEnd()} ${name} `);

export async function handleSupplierPreview(text: string, messageId: number, sid?: number) {
  const b = await load();
  const picked = sid ? b.suppliers.find((x) => x.id === sid) : undefined;
  if (picked) text = withName(text, picked.name);
  else if (NO_NAME.test(text)) {
    if (!b.suppliers.length) {
      return telegram("sendMessage", { reply_to_message_id: messageId, text: "Кому? Напишіть з імʼям, напр. «Оплатив Яворський 500$»." });
    }
    const buttons = b.suppliers.map((x) => ({ text: x.name, callback_data: `suppick:${x.id}` }));
    const keyboard: (typeof buttons)[] = [];
    for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
    keyboard.push([{ text: "Скасувати", callback_data: "cancel" }]);
    return telegram("sendMessage", { reply_to_message_id: messageId, text: "Якому постачальнику?", reply_markup: { inline_keyboard: keyboard } });
  }
  const d = parseSupplierEntry(text, b.suppliers.map((s) => s.name));
  if (!d) {
    return telegram("sendMessage", {
      reply_to_message_id: messageId,
      text: "🤔 Не зрозумів. Напишіть так: «Оплата Іван 10000» або «Прихід Іван cypress 10 пар 500$». Сума в кінці, долари зі знаком $.",
    });
  }
  const s = find(b, d.name);
  const after = debt(s ?? { id: 0, name: "", entries: [] });
  after[d.cur] += d.kind === "pay" ? -d.sum : d.sum;
  await telegram("sendMessage", {
    parse_mode: "HTML",
    reply_to_message_id: messageId,
    text: [
      `<b>${KIND_WORD[d.kind]}</b> · ${esc(s?.name ?? d.name)}${s ? "" : " (новий постачальник)"}`,
      ...(d.note ? [esc(d.note)] : []),
      `Сума: <b>${money(d.sum, d.cur)}</b>`,
      `Борг буде: <b>${moneyT(after)}</b>`,
      "",
      "Записати?",
    ].join("\n"),
    reply_markup: { inline_keyboard: [[{ text: "✅ Записати", callback_data: picked ? `supadd:${picked.id}` : "supadd" }, { text: "Ні", callback_data: "cancel" }]] },
  });
}

export async function handleSupplierAdd(text: string, sid?: number) {
  const b = await load();
  const picked = sid ? b.suppliers.find((x) => x.id === sid) : undefined;
  if (picked) text = withName(text, picked.name);
  const d = parseSupplierEntry(text, b.suppliers.map((s) => s.name));
  if (!d) return telegram("sendMessage", { text: "⚠️ Не зрозумів запис. Напишіть ще раз." });
  let s = find(b, d.name);
  if (!s) {
    s = { id: b.next++, name: d.name, entries: [] };
    b.suppliers.push(s);
  }
  s.entries.push({ id: b.next++, date: today(), kind: d.kind, sum: d.sum, note: d.note, cur: d.cur });
  await save(b);
  await telegram("sendMessage", {
    parse_mode: "HTML",
    text: `✅ Записано. ${esc(s.name)}: борг <b>${moneyT(debt(s))}</b>`,
    reply_markup: { inline_keyboard: [[{ text: "Історія", callback_data: `sup:${s.id}` }]] },
  });
}

export async function handleSuppliers() {
  const b = await load();
  const help = [
    "<b>Як записати:</b>",
    "Прихід Іван cypress 10 пар 19500",
    "Оплата Іван 10000",
    "Борг Іван 25000  (борг, який уже був до початку обліку)",
    "У доларах додай $: Оплата Іван 500$",
  ].join("\n");
  if (!b.suppliers.length) {
    return telegram("sendMessage", { parse_mode: "HTML", text: `Постачальників ще немає.\n\n${help}` });
  }
  const list = [...b.suppliers].sort((x, y) => weight(debt(y)) - weight(debt(x)));
  const total = list.reduce((t, s) => addT(t, debt(s)), { UAH: 0, USD: 0 });
  const lines = ["<b>Борги постачальникам:</b>", ...list.map((s) => `${esc(s.name)}: <b>${moneyT(debt(s))}</b>`), "", `<b>Разом: ${moneyT(total)}</b>`, "", help];
  const buttons = list.map((s) => ({ text: s.name, callback_data: `sup:${s.id}` }));
  const keyboard: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: "Скачати Excel", callback_data: "supcsv" }]);
  await telegram("sendMessage", { parse_mode: "HTML", text: lines.join("\n"), reply_markup: { inline_keyboard: keyboard } });
}

export async function handleSupplierHistory(id: number) {
  const b = await load();
  const s = b.suppliers.find((x) => x.id === id);
  if (!s) return telegram("sendMessage", { text: "Постачальника не знайдено." });
  const run: Totals = { UAH: 0, USD: 0 };
  const rows = s.entries.map((e) => {
    run[e.cur ?? "UAH"] += sign(e);
    return `${e.date.slice(0, 5)} ${KIND_WORD[e.kind]}${e.note ? ` ${esc(e.note)}` : ""}: ${e.kind === "pay" ? "−" : "+"}${money(e.sum, e.cur)} → ${moneyT(run)}`;
  });
  // Telegram обмежує повідомлення 4096 символами: показуємо останні записи.
  const shown = rows.slice(-60);
  const text = [
    `<b>${esc(s.name)}</b>`,
    ...(rows.length > shown.length ? [`(останні ${shown.length} з ${rows.length}, усі є в Excel)`] : []),
    ...shown,
    "",
    `<b>Борг: ${moneyT(debt(s))}</b>`,
  ].join("\n");
  const last = s.entries[s.entries.length - 1];
  await telegram("sendMessage", {
    parse_mode: "HTML",
    text,
    reply_markup: last
      ? { inline_keyboard: [[{ text: "Видалити останній запис", callback_data: `supdel:${s.id}:${last.id}` }]] }
      : undefined,
  });
}

export async function handleSupplierDeleteAsk(sid: number, eid: number) {
  const b = await load();
  const s = b.suppliers.find((x) => x.id === sid);
  const e = s?.entries.find((x) => x.id === eid);
  if (!s || !e) return telegram("sendMessage", { text: "Запис уже видалено." });
  await telegram("sendMessage", {
    parse_mode: "HTML",
    text: `Видалити запис?\n${esc(s.name)}, ${e.date} ${KIND_WORD[e.kind]}${e.note ? ` ${esc(e.note)}` : ""}: ${money(e.sum, e.cur)}`,
    reply_markup: { inline_keyboard: [[{ text: "Так, видалити", callback_data: `supdelok:${sid}:${eid}` }, { text: "Ні", callback_data: "cancel" }]] },
  });
}

export async function handleSupplierDelete(sid: number, eid: number) {
  const b = await load();
  const s = b.suppliers.find((x) => x.id === sid);
  if (!s || !s.entries.some((e) => e.id === eid)) return telegram("sendMessage", { text: "Запис уже видалено." });
  s.entries = s.entries.filter((e) => e.id !== eid);
  if (!s.entries.length) b.suppliers = b.suppliers.filter((x) => x.id !== sid);
  await save(b);
  await telegram("sendMessage", { parse_mode: "HTML", text: `Видалено. ${esc(s.name)}: борг <b>${moneyT(debt(s))}</b>` });
}

// Файл для Excel: CSV з «;» і BOM, щоб українські літери й колонки відкрились правильно.
export function suppliersCsv(b: Book) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const out = [["Постачальник", "Дата", "Що", "Опис", "Валюта", "Взяв на", "Оплатив", "Борг після (ця валюта)"].map(q).join(";")];
  for (const s of b.suppliers) {
    const run: Totals = { UAH: 0, USD: 0 };
    for (const e of s.entries) {
      const cur = e.cur ?? "UAH";
      run[cur] += sign(e);
      out.push([s.name, e.date, KIND_WORD[e.kind], e.note, CUR_SIGN[cur], e.kind === "pay" ? "" : e.sum, e.kind === "pay" ? e.sum : "", run[cur]].map(q).join(";"));
    }
  }
  const total = b.suppliers.reduce((t, s) => addT(t, debt(s)), { UAH: 0, USD: 0 });
  out.push("", [q("Разом борг"), "", "", "", "", "", "", q(moneyT(total))].join(";"));
  return "﻿" + out.join("\r\n");
}

export async function handleSuppliersCsv() {
  const b = await load();
  const form = new FormData();
  form.append("chat_id", String(process.env.TELEGRAM_CHAT_ID));
  form.append("caption", "Розрахунки з постачальниками");
  const name = `postachalnyky-${new Date().toISOString().slice(0, 10)}.csv`;
  form.append("document", new Blob([suppliersCsv(b)], { type: "text/csv" }), name);
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
  if (!res.ok) console.error(`Telegram sendDocument: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
}
