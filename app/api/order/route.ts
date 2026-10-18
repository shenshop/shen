import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { createOrder, keycrmEnabled } from "@/lib/keycrm";
import { normalizePhone } from "@/lib/format";
import type { OrderRequest } from "@/lib/types";
import { orderMessage, sendTelegram } from "@/lib/telegram";
import { itemName } from "@/lib/variants";

const bad = (message: string) => NextResponse.json({ error: message }, { status: 400 });

export async function POST(req: Request) {
  let body: OrderRequest & { website?: string };
  try {
    body = await req.json();
  } catch {
    return bad("Некоректний запит");
  }

  // Приховане поле-пастка для ботів.
  if (body.website) return NextResponse.json({ ok: true, id: 0 });

  const name = String(body.name ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(body.phone ?? ""));
  if (name.length < 2) return bad("Вкажіть імʼя");
  if (!phone) return bad("Вкажіть номер телефону у форматі 0XX XXX XX XX");
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) return bad("Корзина порожня");
  if (!body.quick && (!body.delivery?.city || !body.delivery?.point)) return bad("Вкажіть місто та відділення");

  // Ціни беремо з каталогу, а не з браузера.
  const { products } = await getCatalog();
  const variants = new Map(products.flatMap((p) => p.variants.map((v) => [v.sku, { product: p, variant: v }] as const)));
  const items = [];
  for (const item of body.items) {
    const found = variants.get(String(item.sku));
    if (!found) return bad("Один із товарів більше недоступний. Оновіть корзину.");
    const quantity = Math.max(1, Math.min(10, Math.floor(Number(item.quantity) || 1)));
    items.push({
      sku: found.variant.sku,
      name: itemName(found.product, found.variant),
      size: found.variant.size,
      price: found.variant.price,
      quantity,
      image: found.product.images[0]?.startsWith("http") ? found.product.images[0] : "",
    });
  }
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const order: OrderRequest = {
    name,
    phone,
    comment: String(body.comment ?? "").slice(0, 1000) || undefined,
    delivery: body.quick ? undefined : body.delivery,
    payment: body.payment === "prepay" ? "prepay" : "cod",
    items,
    utm: body.utm,
    quick: Boolean(body.quick),
  };

  if (!keycrmEnabled()) {
    console.log("[demo] замовлення (KeyCRM не підключено):", JSON.stringify({ ...order, total }));
    return NextResponse.json({ ok: true, id: Math.floor(Date.now() / 1000) % 100000, total, demo: true });
  }

  try {
    const created = await createOrder(order, total);
    await sendTelegram(orderMessage(order, total, created.id));
    return NextResponse.json({ ok: true, id: created.id, total });
  } catch (e) {
    console.error(e);
    // KeyCRM недоступний: якщо замовлення дійшло в Telegram, клієнт його не втрачає.
    if (await sendTelegram(orderMessage(order, total, null))) {
      return NextResponse.json({ ok: true, id: Math.floor(Date.now() / 1000) % 100000, total });
    }
    return NextResponse.json(
      { error: "Не вдалося оформити замовлення. Спробуйте ще раз або зателефонуйте нам." },
      { status: 502 },
    );
  }
}
