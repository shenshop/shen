import "server-only";
import { esc, telegram } from "./telegram";
import { buildPlan, MAX_MOVES, moveOrders, type PlannedOrder } from "./stock-check";

export const CHECK_BUTTON = "📦 Перевірити склад";

// Секрет вебхука виводимо з токена бота, щоб не заводити ще одну змінну в Cloudflare.
export async function webhookSecret() {
  const data = new TextEncoder().encode(`shen-webhook:${process.env.TELEGRAM_BOT_TOKEN}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const line = (o: PlannedOrder) =>
  `№${o.id}${o.awaitingDelivery ? " (чекаєм поставку)" : ""} · ${o.lines.map((l) => esc(l.sku) + (l.qty > 1 ? ` ×${l.qty}` : "")).join(", ")}${o.buyer ? ` · ${esc(o.buyer)}` : ""}`;

const send = (text: string, extra: object = {}) =>
  telegram("sendMessage", { text: text.slice(0, 4000), parse_mode: "HTML", ...extra });

export async function handleCheck() {
  const plan = await buildPlan();
  const lines = [`<b>Склад «Основний», замовлення «Виготовляється» і «Чекаєм поставку»</b>`, ""];
  if (plan.ready.length) {
    lines.push(`✅ <b>Товар є, Нова Пошта, можна в «Готово до відгрузки» (${plan.ready.length}):</b>`, ...plan.ready.map(line));
  } else lines.push("✅ Поки немає замовлень з Новою Поштою, для яких є товар на складі.");
  if (plan.readyOther.length) {
    lines.push(
      "",
      `📦 <b>Товар є, але інша доставка, переведіть вручну (${plan.readyOther.length}):</b>`,
      ...plan.readyOther.map((o) => `${line(o)} · ${esc(o.service)}`),
    );
  }
  if (plan.waiting.length) lines.push("", `⏳ <b>Ще чекають товар (${plan.waiting.length}):</b>`, ...plan.waiting.map(line));
  const n = Math.min(plan.ready.length, MAX_MOVES);
  await send(
    lines.join("\n"),
    n
      ? {
          reply_markup: {
            inline_keyboard: [[
              { text: `✅ Так, перевести ${n}`, callback_data: "move" },
              { text: "Ні", callback_data: "cancel" },
            ]],
          },
        }
      : {},
  );
}

export async function handleMove() {
  // Перераховуємо заново: склад міг змінитись після перевірки.
  const plan = await buildPlan();
  if (!plan.ready.length) return send("Зараз немає замовлень з Новою Поштою, для яких є товар. Нічого не змінено.");
  const { moved, error } = await moveOrders(plan);
  const lines = [`✅ <b>Переведено в «Готово до відгрузки»: ${moved.length}</b>`, ...moved.map(line)];
  const left = plan.ready.length - moved.length;
  if (error) lines.push("", `⚠️ KeyCRM не прийняв зміну: ${esc(error.slice(0, 300))}`);
  if (left > 0) lines.push("", `Ще ${left} можна перевести. Натисніть «${CHECK_BUTTON}» через хвилину (ліміт KeyCRM).`);
  await send(lines.join("\n"));
}
