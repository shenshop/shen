import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { markRefusalDone } from "@/lib/refusals";
import { markReminded } from "@/lib/pickup-reminder";
import { looksLikeOrder } from "@/lib/manual-order";
import { looksLikeProduct, photoUpdateSku, rememberPhoto } from "@/lib/new-product";
import { CHECK_BUTTON, handleCheck, handleMove, handleManualCreate, handleManualPreview, handleProductCreate, handleProductPreview, handlePhotoPreview, handlePhotoReplace, handlePickups, handleReasonButton, handleReasonText, handleRefresh, handleRefusals, handleSent, handleTtnList, PICKUP_BUTTON, REASON_PROMPT, REFRESH_BUTTON, REFUSALS_BUTTON, TTN_BUTTON, webhookSecret } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

type Update = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    media_group_id?: string;
    photo?: { file_id: string; width: number }[];
    reply_to_message?: { text?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number; reply_to_message?: { message_id?: number; text?: string; caption?: string } };
  };
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
      // Кнопки причини відмови не прибираємо: повідомлення лишається, щоб можна було ще написати клієнту.
      const why = cb.data?.match(/^why:(\d+):(\w+)$/);
      if (why) {
        await handleReasonButton(Number(why[1]), why[2]);
        return NextResponse.json({ ok: true });
      }
      const sent = cb.data?.match(/^sent:(\d+)$/);
      // Спочатку ставимо тег у KeyCRM, щоб позначка в чаті не зʼявилась, якщо тег не поставився.
      if (sent) await handleSent(Number(sent[1]));
      const refused = cb.data?.match(/^refused:(\d+)$/);
      if (refused) await markRefusalDone(Number(refused[1]));
      const reminded = cb.data?.match(/^reminded:(\d+)$/);
      if (reminded) await markReminded(Number(reminded[1]));
      // Прибираємо кнопки, щоб не натиснути двічі; після «Надіслано» лишаємо позначку.
      if (cb.message) {
        await telegram("editMessageReplyMarkup", {
          message_id: cb.message.message_id,
          reply_markup: { inline_keyboard: sent
            ? [[{ text: "✅ Надіслано клієнту", callback_data: "noop" }]]
            : refused || reminded
              ? [[{ text: "✅ Написали клієнту", callback_data: "noop" }]]
              : [] },
        });
      }
      if (cb.data === "mkorder") {
        const original = cb.message?.reply_to_message?.text;
        if (original) await handleManualCreate(original);
        else await telegram("sendMessage", { text: "⚠️ Не бачу вихідного повідомлення. Надішліть дані замовлення ще раз." });
      }
      const mkprod = cb.data?.match(/^mkprod:(.*)$/);
      if (mkprod) {
        const original = cb.message?.reply_to_message?.caption ?? cb.message?.reply_to_message?.text;
        if (original) await handleProductCreate(original, mkprod[1], new URL(req.url).origin, cb.message?.reply_to_message?.message_id);
        else await telegram("sendMessage", { text: "⚠️ Не бачу вихідного повідомлення. Надішліть товар ще раз." });
      }
      const mkphoto = cb.data?.match(/^mkphoto:([^:]+)(?::(\d+))?$/);
      if (mkphoto) {
        const original = cb.message?.reply_to_message?.caption;
        if (original) await handlePhotoReplace(original, mkphoto[1], new URL(req.url).origin, cb.message?.reply_to_message?.message_id, mkphoto[2] ? Number(mkphoto[2]) : undefined);
        else await telegram("sendMessage", { text: "⚠️ Не бачу вихідного альбому. Надішліть його ще раз." });
      }
      if (cb.data === "move") await handleMove();
      else if (cb.data === "cancel") await telegram("sendMessage", { text: "Добре, нічого не змінюю." });
    } else if (update.message?.photo?.length) {
      // Фото нового товару. Альбом приходить окремими повідомленнями, підпис лише в одному з них.
      const msg = update.message;
      const group = msg.media_group_id ?? `m${msg.message_id}`;
      const biggest = [...msg.photo!].sort((a, b) => b.width - a.width)[0];
      await rememberPhoto(group, msg.message_id, biggest.file_id);
      if (msg.caption && looksLikeProduct(msg.caption)) {
        // Чекаємо, поки дійдуть решта фото альбому, щоб у перевірці була правильна кількість.
        await new Promise((r) => setTimeout(r, 4000));
        await handleProductPreview(msg.caption, msg.message_id, group);
      } else if (msg.caption && photoUpdateSku(msg.caption)) {
        await new Promise((r) => setTimeout(r, 4000));
        await handlePhotoPreview(msg.caption, msg.message_id, group);
      }
    } else {
      const text = update.message?.text?.trim() ?? "";
      const reasonFor = update.message?.reply_to_message?.text?.match(REASON_PROMPT);
      if (reasonFor && text) {
        await handleReasonText(Number(reasonFor[1]), text);
        return NextResponse.json({ ok: true });
      }
      if (text === CHECK_BUTTON || text.startsWith("/sklad") || text.startsWith("/start")) await handleCheck();
      else if (text === TTN_BUTTON || text.startsWith("/ttn")) await handleTtnList(new URL(req.url).origin);
      else if (text === REFUSALS_BUTTON || text.startsWith("/vidmovy")) await handleRefusals(new URL(req.url).origin);
      else if (looksLikeProduct(text)) await handleProductPreview(text, update.message!.message_id, null);
      else if (looksLikeOrder(text)) await handleManualPreview(text, update.message!.message_id);
      else if (text === PICKUP_BUTTON || text.startsWith("/nezabraly")) await handlePickups(new URL(req.url).origin);
      else if (text === REFRESH_BUTTON || text.startsWith("/refresh")) await handleRefresh();
    }
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Помилка: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
