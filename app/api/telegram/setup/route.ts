import { NextResponse } from "next/server";
import { telegram, telegramEnabled } from "@/lib/telegram";
import { KEYBOARD, webhookSecret } from "@/lib/telegram-bot";

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
  await telegram("setMyCommands", {
    commands: [
      { command: "sklad", description: "Перевірити склад" },
      { command: "ttn", description: "ТТН клієнтам" },
    ],
  });
  const keyboard = await telegram("sendMessage", {
    text: "Кнопки внизу чату: «📦 Перевірити склад» після приходу товару і «📮 ТТН клієнтам» після відправки.",
    reply_markup: KEYBOARD,
  });
  return NextResponse.json({ ok: webhook && keyboard, webhook: `${origin}/api/telegram` });
}
