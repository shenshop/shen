import { NextResponse } from "next/server";
import { setupShopBot, shopBotEnabled } from "@/lib/shop-bot";

export const dynamic = "force-dynamic";

// Одноразове підключення бота для клієнтів: відкрити /api/shop-bot/setup у браузері.
export async function GET(req: Request) {
  if (!shopBotEnabled()) return NextResponse.json({ error: "Немає секрету SHOP_BOT_TOKEN у Cloudflare" }, { status: 500 });
  return NextResponse.json(await setupShopBot(new URL(req.url).origin));
}
