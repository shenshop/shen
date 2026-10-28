import { NextResponse } from "next/server";
import { telegram, telegramEnabled } from "@/lib/telegram";
import { CHECK_BUTTON, webhookSecret } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

// Одноразове підключення бота: відкрити /api/telegram/setup у браузері.
// Безпечно відкривати повторно: бот лише знову привʼязується до цього сайту.
export async function GET(req: Request) {
  if (!telegramEnabled()) return NextResponse.json({ error: "Telegram не налаштовано" }, { status: 500 });
  const origin = new URL(req.url).origin;
  const webhook = await telegram("setWebhook", {
    url: `${origin}/api/telegram`,
    secret_token: await webhookSecret(),
    allowed_updates: ["message", "callback_query"],
  });
  await telegram("setMyCommands", { commands: [{ command: "sklad", description: "Перевірити склад" }] });
  const keyboard = await telegram("sendMessage", {
    text: "Кнопка «Перевірити склад» тепер внизу чату. Натисніть її після приходу товару.",
    reply_markup: { keyboard: [[{ text: CHECK_BUTTON }]], resize_keyboard: true, is_persistent: true },
  });
  return NextResponse.json({ ok: webhook && keyboard, webhook: `${origin}/api/telegram` });
}
