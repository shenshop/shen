import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { CHECK_BUTTON, handleCheck, handleMove, webhookSecret } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
};

// Вебхук Telegram-бота: кнопка «Перевірити склад» і підтвердження переведення замовлень.
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => ({}))) as Update;
  const owner = String(process.env.TELEGRAM_CHAT_ID);
  const chatId = String(update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? "");
  // Відповідаємо лише власнику магазину.
  if (chatId !== owner) return NextResponse.json({ ok: true });

  try {
    const cb = update.callback_query;
    if (cb) {
      await telegram("answerCallbackQuery", { callback_query_id: cb.id });
      // Прибираємо кнопки, щоб не натиснути двічі.
      if (cb.message) {
        await telegram("editMessageReplyMarkup", { message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      }
      if (cb.data === "move") await handleMove();
      else if (cb.data === "cancel") await telegram("sendMessage", { text: "Добре, нічого не змінюю." });
    } else {
      const text = update.message?.text?.trim() ?? "";
      if (text === CHECK_BUTTON || text.startsWith("/sklad") || text.startsWith("/start")) await handleCheck();
    }
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Не вдалося перевірити склад: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
