import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { CHECK_BUTTON, handleCheck, handleMove, handleRefresh, handleSent, handleTtnList, REFRESH_BUTTON, TTN_BUTTON, webhookSecret } from "@/lib/telegram-bot";

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
      if (cb.data === "noop") return NextResponse.json({ ok: true });
      const sent = cb.data?.match(/^sent:(\d+)$/);
      // Спочатку ставимо тег у KeyCRM, щоб позначка в чаті не зʼявилась, якщо тег не поставився.
      if (sent) await handleSent(Number(sent[1]));
      // Прибираємо кнопки, щоб не натиснути двічі; після «Надіслано» лишаємо позначку.
      if (cb.message) {
        await telegram("editMessageReplyMarkup", {
          message_id: cb.message.message_id,
          reply_markup: { inline_keyboard: sent ? [[{ text: "✅ Надіслано клієнту", callback_data: "noop" }]] : [] },
        });
      }
      if (cb.data === "move") await handleMove();
      else if (cb.data === "cancel") await telegram("sendMessage", { text: "Добре, нічого не змінюю." });
    } else {
      const text = update.message?.text?.trim() ?? "";
      if (text === CHECK_BUTTON || text.startsWith("/sklad") || text.startsWith("/start")) await handleCheck();
      else if (text === TTN_BUTTON || text.startsWith("/ttn")) await handleTtnList(new URL(req.url).origin);
      else if (text === REFRESH_BUTTON || text.startsWith("/refresh")) await handleRefresh();
    }
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Помилка: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
