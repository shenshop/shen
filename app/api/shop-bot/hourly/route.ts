import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { webhookSecret } from "@/lib/telegram-bot";
import { autoSendTtns } from "@/lib/shop-bot-jobs";

export const dynamic = "force-dynamic";

// Щогодини (cron у worker.js): клієнтам, які підключили бот, бот сам надсилає ТТН.
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await autoSendTtns();
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Автоматичні ТТН у Telegram: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
