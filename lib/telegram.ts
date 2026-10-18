import "server-only";
import { formatPrice } from "./format";
import type { OrderRequest } from "./types";

// Сповіщення про замовлення в Telegram. Працює, якщо в Cloudflare задано
// TELEGRAM_BOT_TOKEN (секрет) і TELEGRAM_CHAT_ID; інакше нічого не робить.
export function telegramEnabled() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function orderMessage(order: OrderRequest, total: number, crmId: number | null) {
  const lines = [
    crmId != null
      ? `🛍 <b>Нове замовлення №${crmId}</b>`
      : "⚠️ <b>Нове замовлення НЕ потрапило в KeyCRM!</b> Внесіть його вручну.",
    order.quick ? "Швидке замовлення (передзвонити)" : "",
    "",
    `👤 ${esc(order.name)}`,
    `📞 ${esc(order.phone)}`,
    "",
    ...order.items.map((i) => `• ${esc(i.name)}, розмір ${esc(i.size)} × ${i.quantity} = ${formatPrice(i.price * i.quantity)}`),
    `<b>Разом: ${formatPrice(total)}</b>`,
  ];
  if (order.delivery) {
    const service = order.delivery.service === "ukrposhta" ? "Укрпошта" : "Нова Пошта";
    lines.push("", `🚚 ${service}: ${esc(order.delivery.city)}, ${esc(order.delivery.point)}`);
    lines.push(order.payment === "prepay" ? "💳 Передоплата" : "💵 Накладений платіж");
  }
  if (order.comment) lines.push("", `💬 ${esc(order.comment)}`);
  // Готовий текст для уточнення розміру у Viber (натиснути, щоб скопіювати).
  const first = order.items[0];
  if (first) {
    const model = first.name.charAt(0).toLowerCase() + first.name.slice(1);
    const size = parseInt(first.size, 10);
    lines.push(
      "",
      "Текст для Viber (натисніть, щоб скопіювати):",
      `<code>Доброго дня! Ви зробили замовлення на ${esc(model)}.\n\nВи носите зазвичай розмір ${esc(first.size)}?${
        Number.isFinite(size) ? ` Чи буває ${size - 1}?` : ""
      }</code>`,
    );
  }
  return lines.filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n");
}

export async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramEnabled()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}
