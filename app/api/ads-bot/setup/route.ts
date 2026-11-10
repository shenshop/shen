import { NextResponse } from "next/server";
import { adsBotEnabled, setupAdsBot } from "@/lib/ads-bot";

export const dynamic = "force-dynamic";

// Одноразове підключення бота реклами: відкрити /api/ads-bot/setup у браузері.
export async function GET(req: Request) {
  if (!adsBotEnabled()) return NextResponse.json({ error: "Немає секретів ADS_BOT_TOKEN і META_TOKEN у Cloudflare" }, { status: 500 });
  return NextResponse.json(await setupAdsBot(new URL(req.url).origin));
}
