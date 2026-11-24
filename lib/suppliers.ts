import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { esc, telegram } from "./telegram";

// Розрахунки з постачальниками: прихід товару, оплати і борг. KeyCRM такого не вміє,
// тому записи лежать у сховищі Cloudflare (KV сайту) одним документом.

type KV = { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
const kv = () => (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
const KEY = "suppliers:v1";

export type Kind = "in" | "pay" | "start";
export type Entry = { id: number; date: string; kind: Kind; sum: number; note: string };
export type Supplier = { id: number; name: string; entries: Entry[] };
type Book = { next: number; suppliers: Supplier[] };

export const SUPPLIERS_BUTTON = "🧾 Постачальники";

async function load(): Promise<Book> {
  const raw = await kv().get(KEY);
  return raw ? (JSON.parse(raw) as Book) : { next: 1, suppliers: [] };
}
const save = (b: Book) => kv().put(KEY, JSON.stringify(b));

const today = () => new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });
const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA").replace(/\s/g, " ")} грн`;
export const debt = (s: Supplier) => s.entries.reduce((d, e) => d + (e.kind === "pay" ? -e.sum : e.sum), 0);
const KIND_WORD: Record<Kind, string> = { in: "Прихід", pay: "Оплата", start: "Борг на початок" };

// «Прихід Іван cypress 10 пар 19500», «Оплата Іван 10000», «Борг Іван 25000» (борг, який уже був).
const RE = /^\s*(прих[іi]д товару|прих[іi]д|взяв|оплата|оплатив|борг)\s+(.+?)\s+(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:грн\.?)?\s*$/is;

export type Draft = { kind: Kind; name: string; note: string; sum: number };

export function parseSupplierEntry(text: string, known: string[] = []): Draft | null {
  const m = text.match(RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const kind: Kind = word.startsWith("опла") ? "pay" : word === "борг" ? "start" : "in";
  const sum = Number(m[3].replace(/[\s\u00a0]/g, ""));
  if (!(sum > 0)) return null;
  let rest = m[2].trim();
  // Імʼя постачальника: найдовше відоме імʼя на початку, інакше перше слово.
  const hit = known
    .filter((n) => rest.toLowerCase() === n.toLowerCase() || rest.toLowerCase().startsWith(n.toLowerCase() + " "))
    .sort((a, b) => b.length - a.length)[0];
  const name = hit ?? rest.split(/\s+/)[0];
  rest = rest.slice(name.length).trim();
  return { kind, name, note: rest, sum };
}

export function looksLikeSupplierEntry(text: string) {
  return RE.test(text);
}

function find(b: Book, name: string) {
  return b.suppliers.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export async function handleSupplierPreview(text: string, messageId: number) {
  const b = await load();
  const d = parseSupplierEntry(text, b.suppliers.map((s) => s.name));
  if (!d) return;
  const s = find(b, d.name);
  const before = s ? debt(s) : 0;
  const after = before + (d.kind === "pay" ? -d.sum : d.sum);
  await telegram("sendMessage", {
    parse_mode: "HTML",
    reply_to_message_id: messageId,
    text: [
      `<b>${KIND_WORD[d.kind]}</b> · ${esc(s?.name ?? d.name)}${s ? "" : " (новий постачальник)"}`,
      ...(d.note ? [esc(d.note)] : []),
      `Сума: <b>${money(d.sum)}</b>`,
      `Борг буде: <b>${money(after)}</b>`,
      "",
      "Записати?",
    ].join("\n"),
    reply_markup: { inline_keyboard: [[{ text: "✅ Записати", callback_data: "supadd" }, { text: "Ні", callback_data: "cancel" }]] },
  });
}

export async function handleSupplierAdd(text: string) {
  const b = await load();
  const d = parseSupplierEntry(text, b.suppliers.map((s) => s.name));
  if (!d) return telegram("sendMessage", { text: "⚠️ Не зрозумів запис. Напишіть ще раз." });
  let s = find(b, d.name);
  if (!s) {
    s = { id: b.next++, name: d.name, entries: [] };
    b.suppliers.push(s);
  }
  s.entries.push({ id: b.next++, date: today(), kind: d.kind, sum: d.sum, note: d.note });
  await save(b);
  await telegram("sendMessage", {
    parse_mode: "HTML",
    text: `✅ Записано. ${esc(s.name)}: борг <b>${money(debt(s))}</b>`,
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
  ].join("\n");
  if (!b.suppliers.length) {
    return telegram("sendMessage", { parse_mode: "HTML", text: `Постачальників ще немає.\n\n${help}` });
  }
  const list = [...b.suppliers].sort((x, y) => debt(y) - debt(x));
  const total = list.reduce((t, s) => t + debt(s), 0);
  const lines = ["<b>Борги постачальникам:</b>", ...list.map((s) => `${esc(s.name)}: <b>${money(debt(s))}</b>`), "", `<b>Разом: ${money(total)}</b>`, "", help];
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
  let run = 0;
  const rows = s.entries.map((e) => {
    run += e.kind === "pay" ? -e.sum : e.sum;
    return `${e.date.slice(0, 5)} ${KIND_WORD[e.kind]}${e.note ? ` ${esc(e.note)}` : ""}: ${e.kind === "pay" ? "−" : "+"}${money(e.sum)} → ${money(run)}`;
  });
  // Telegram обмежує повідомлення 4096 символами: показуємо останні записи.
  const shown = rows.slice(-60);
  const text = [
    `<b>${esc(s.name)}</b>`,
    ...(rows.length > shown.length ? [`(останні ${shown.length} з ${rows.length}, усі є в Excel)`] : []),
    ...shown,
    "",
    `<b>Борг: ${money(debt(s))}</b>`,
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
    text: `Видалити запис?\n${esc(s.name)}, ${e.date} ${KIND_WORD[e.kind]}${e.note ? ` ${esc(e.note)}` : ""}: ${money(e.sum)}`,
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
  await telegram("sendMessage", { parse_mode: "HTML", text: `Видалено. ${esc(s.name)}: борг <b>${money(debt(s))}</b>` });
}

// Файл для Excel: CSV з «;» і BOM, щоб українські літери й колонки відкрились правильно.
export function suppliersCsv(b: Book) {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const out = [["Постачальник", "Дата", "Що", "Опис", "Взяв на, грн", "Оплатив, грн", "Борг після, грн"].map(q).join(";")];
  for (const s of b.suppliers) {
    let run = 0;
    for (const e of s.entries) {
      run += e.kind === "pay" ? -e.sum : e.sum;
      out.push([s.name, e.date, KIND_WORD[e.kind], e.note, e.kind === "pay" ? "" : e.sum, e.kind === "pay" ? e.sum : "", run].map(q).join(";"));
    }
  }
  out.push("", [q("Разом борг"), "", "", "", "", "", q(b.suppliers.reduce((t, s) => t + debt(s), 0))].join(";"));
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
