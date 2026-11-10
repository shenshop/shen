import { NextResponse } from "next/server";
import { adsWebhookSecret, handleAdsUpdate } from "@/lib/ads-bot";
import { seenUpdate } from "@/lib/tg-dedupe";

export const dynamic = "force-dynamic";

// Вебхук бота для реклами (lib/ads-bot.ts).
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await adsWebhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const update = await req.json();
    if (await seenUpdate("ads", update?.update_id).catch(() => false)) return NextResponse.json({ ok: true });
    await handleAdsUpdate(update);
  } catch (e) {
    console.error(e);
  }
  return NextResponse.json({ ok: true });
}
