import { NextResponse } from "next/server";
import { handleShopUpdate, shopWebhookSecret } from "@/lib/shop-bot";
import { seenUpdate } from "@/lib/tg-dedupe";

export const dynamic = "force-dynamic";

// Вебхук бота для клієнтів (lib/shop-bot.ts).
export async function POST(req: Request) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== (await shopWebhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const update = await req.json();
    if (await seenUpdate("shop", update?.update_id).catch(() => false)) return NextResponse.json({ ok: true });
    await handleShopUpdate(update);
  } catch (e) {
    console.error(e);
  }
  return NextResponse.json({ ok: true });
}
