import { NextResponse } from "next/server";
import { handleShopUpdate, shopWebhookSecret } from "@/lib/shop-bot";

export const dynamic = "force-dynamic";

// Вебхук бота для клієнтів (lib/shop-bot.ts).
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await shopWebhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await handleShopUpdate(await req.json());
  } catch (e) {
    console.error(e);
  }
  return NextResponse.json({ ok: true });
}
