import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { webhookSecret } from "@/lib/telegram-bot";
import { remindSilent } from "@/lib/shop-bot";

export const dynamic = "force-dynamic";

// Кожні 15 хвилин (cron у worker.js): клієнтам, які мовчать 2+ години, бот перепитує. ТТН — лише кнопкою «📮 ТТН клієнтам» (так хоче Дрон).
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await remindSilent();
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Нагадування клієнтам у Telegram: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
