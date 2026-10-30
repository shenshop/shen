import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { handlePickups, webhookSecret } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

// Щоденна перевірка (cron у worker.js): нагадування про посилки, які 3-й день лежать у відділенні.
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await handlePickups(new URL(req.url).origin, true);
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Щоденна перевірка посилок: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
