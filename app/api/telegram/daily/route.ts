import { NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";
import { handlePickups, webhookSecret } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

// Щоденна перевірка (cron у worker.js): нагадування про посилки, які 3-й день лежать у відділенні.
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // Cron спрацьовує о 07:00 і 08:00 UTC; працюємо лише тоді, коли в Києві 10:00 (і взимку, і влітку).
  const kyivHour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }));
  if (kyivHour !== 10) return NextResponse.json({ ok: true, skipped: kyivHour });
  try {
    await handlePickups(new URL(req.url).origin, true);
  } catch (e) {
    console.error(e);
    await telegram("sendMessage", { text: `⚠️ Щоденна перевірка посилок: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` });
  }
  return NextResponse.json({ ok: true });
}
