import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { esc, telegram } from "./telegram";
import { buildPlan, MAX_MOVES, moveOrders, type PlannedOrder } from "./stock-check";
import { customerText, markSent, ordersToNotify, stats, viberDigits } from "./ttn-notify";
import { refusals, refusalText } from "./refusals";
import { pickupsWaiting, pickupText } from "./pickup-reminder";

export const CHECK_BUTTON = "📦 Перевірити склад";
export const TTN_BUTTON = "📮 ТТН клієнтам";
export const REFRESH_BUTTON = "🔄 Оновити сайт";
export const REFUSALS_BUTTON = "↩️ Відмови";
export const PICKUP_BUTTON = "📬 Не забрали";
export const KEYBOARD = {
  keyboard: [[{ text: CHECK_BUTTON }, { text: TTN_BUTTON }], [{ text: REFUSALS_BUTTON }, { text: PICKUP_BUTTON }], [{ text: REFRESH_BUTTON }]],
  resize_keyboard: true,
  is_persistent: true,
};

// Секрет вебхука виводимо з токена бота, щоб не заводити ще одну змінну в Cloudflare.
export async function webhookSecret() {
  const data = new TextEncoder().encode(`shen-webhook:${process.env.TELEGRAM_BOT_TOKEN}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const line = (o: PlannedOrder) =>
  `№${o.id}${o.awaitingDelivery ? " (чекаєм поставку)" : ""} · ${o.lines.map((l) => esc(l.sku) + (l.qty > 1 ? ` ×${l.qty}` : "")).join(", ")}${o.buyer ? ` · ${esc(o.buyer)}` : ""}`;

// Артикул «221 кор-42» = модель «221 кор» + розмір «42». Групуємо, скільки пар кожного розміру треба.
function needSummary(orders: PlannedOrder[]) {
  const byModel = new Map<string, Map<string, number>>();
  for (const o of orders) {
    for (const l of o.lines) {
      const m = l.sku.trim().match(/^(.*?)[-\s]+(\d{2}(?:[.,]5)?)$/);
      const model = m ? m[1].trim() : l.sku.trim();
      const size = m ? m[2] : "—";
      const sizes = byModel.get(model) ?? new Map<string, number>();
      sizes.set(size, (sizes.get(size) ?? 0) + l.qty);
      byModel.set(model, sizes);
    }
  }
  return [...byModel]
    .map(([model, sizes]) => {
      const list = [...sizes].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]));
      return { model, sizes: list, total: list.reduce((sum, [, n]) => sum + n, 0) };
    })
    .sort((a, b) => a.model.localeCompare(b.model, "uk"));
}

const send = (text: string, extra: object = {}) =>
  telegram("sendMessage", { text: text.slice(0, 4000), parse_mode: "HTML", ...extra });

export async function handleCheck() {
  const plan = await buildPlan();
  const lines = [`<b>Склад «Основний», замовлення «Виготовляється» і «Чекаєм поставку»</b>`, ""];
  if (plan.ready.length) {
    lines.push(`✅ <b>Товар є, Нова Пошта, можна в «Готово до відгрузки» (${plan.ready.length}):</b>`, ...plan.ready.map(line));
  } else lines.push("✅ Поки немає замовлень з Новою Поштою, для яких є товар на складі.");
  if (plan.readyOther.length) {
    lines.push(
      "",
      `📦 <b>Товар є, але інша доставка, переведіть вручну (${plan.readyOther.length}):</b>`,
      ...plan.readyOther.map((o) => `${line(o)} · ${esc(o.service)}`),
    );
  }
  if (plan.waiting.length) {
    const groups = needSummary(plan.waiting);
    const pairs = groups.reduce((sum, g) => sum + g.total, 0);
    lines.push("", `⏳ <b>Треба замовити (${pairs} пар, ${plan.waiting.length} замовлень):</b>`);
    for (const g of groups) {
      lines.push(`<b>${esc(g.model)}</b>: ${g.sizes.map(([size, n]) => `${esc(size)} — ${n}`).join(", ")}${g.sizes.length > 1 ? ` (разом ${g.total})` : ""}`);
    }
  }
  const n = Math.min(plan.ready.length, MAX_MOVES);
  await send(
    lines.join("\n"),
    n
      ? {
          reply_markup: {
            inline_keyboard: [[
              { text: `✅ Так, перевести ${n}`, callback_data: "move" },
              { text: "Ні", callback_data: "cancel" },
            ]],
          },
        }
      : {},
  );
}

export async function handleMove() {
  // Перераховуємо заново: склад міг змінитись після перевірки.
  const plan = await buildPlan();
  if (!plan.ready.length) return send("Зараз немає замовлень з Новою Поштою, для яких є товар. Нічого не змінено.");
  const { moved, error } = await moveOrders(plan);
  const lines = [`✅ <b>Переведено в «Готово до відгрузки»: ${moved.length}</b>`, ...moved.map(line)];
  const left = plan.ready.length - moved.length;
  if (error) lines.push("", `⚠️ KeyCRM не прийняв зміну: ${esc(error.slice(0, 300))}`);
  if (left > 0) lines.push("", `Ще ${left} можна перевести. Натисніть «${CHECK_BUTTON}» через хвилину (ліміт KeyCRM).`);
  await send(lines.join("\n"));
}

// Кожне відправлене замовлення окремим повідомленням: текст для клієнта (торкнутися, щоб скопіювати),
// кнопка відкрити чат у Viber і кнопка «Надіслано», яка ставить тег у KeyCRM.
export async function handleTtnList(origin: string) {
  const list = await ordersToNotify();
  if (!list.length) {
    return send(
      `📮 Немає відправлених замовлень, яким ще не надіслали ТТН.\n\n` +
        `«Передано в доставку»: ${stats.inStatus}, з ТТН і телефоном: ${stats.withTtn}, ` +
        `без тегу «ТТН надіслано»: ${stats.notSent}, за ${4} дні: ${stats.recent}` +
        (stats.inStatus && !stats.withTtn ? `\n${esc(stats.sample)}` : ""),
    );
  }
  await send(`📮 <b>Відправлені, клієнтам ще не надіслано ТТН: ${list.length}</b>\nТоркніться тексту, щоб скопіювати, відкрийте Viber і вставте.`);
  for (const n of list) {
    await send(`<b>№${n.id}</b>${n.buyer ? ` · ${esc(n.buyer)}` : ""} · ${esc(n.phone)}\n\n<code>${esc(customerText(n))}</code>`, {
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[
          { text: "💬 Відкрити Viber", url: `${origin}/viber/${viberDigits(n.phone)}` },
          { text: "✅ Надіслано", callback_data: `sent:${n.id}` },
        ]],
      },
    });
  }
}

// Відмови від отримання за останні 2 дні: текст для клієнта, Viber і «Написав» (тег у KeyCRM).
export async function handleRefusals(origin: string) {
  const { list, statuses } = await refusals();
  if (!list.length) return send(`↩️ Нових відмов немає (статуси: ${esc(statuses.join(", "))}).`);
  await send(`↩️ <b>Відмови від отримання: ${list.length}</b>\nТоркніться тексту, щоб скопіювати, відкрийте Viber і вставте.`);
  for (const r of list) {
    await send(
      `<b>№${r.id}</b>${r.buyer ? ` · ${esc(r.buyer)}` : ""}\n📞 <code>${esc(r.phone)}</code>${r.items ? `\n👟 ${esc(r.items)}` : ""}\n\n<code>${esc(refusalText)}</code>`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "💬 Відкрити Viber", url: `${origin}/viber/${viberDigits(r.phone)}` },
            { text: "✅ Написав", callback_data: `refused:${r.id}` },
          ]],
        },
      },
    );
  }
}

// Посилки, що лежать у відділенні з 3-го дня. quiet: щоденна перевірка мовчить, коли список порожній.
export async function handlePickups(origin: string, quiet = false) {
  const list = await pickupsWaiting();
  if (!list.length) return quiet ? undefined : send("📬 Немає посилок, які лежать у відділенні 3-й день і довше.");
  await send(`📬 <b>Посилки чекають у відділенні, клієнт не забрав: ${list.length}</b>\nТоркніться тексту, щоб скопіювати, відкрийте Viber і вставте.`);
  for (const p of list) {
    await send(
      `<b>№${p.id}</b>${p.buyer ? ` · ${esc(p.buyer)}` : ""} · ${p.days}-й день у відділенні${p.storageFrom ? `, платне зберігання з ${esc(p.storageFrom)}` : ""}\n📞 <code>${esc(p.phone)}</code>\n\n<code>${esc(pickupText(p))}</code>`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "💬 Відкрити Viber", url: `${origin}/viber/${viberDigits(p.phone)}` },
            { text: "✅ Написав", callback_data: `reminded:${p.id}` },
          ]],
        },
      },
    );
  }
}

export async function handleSent(orderId: number) {
  await markSent(orderId);
}

// Те саме, що /api/revalidate: скидаємо збережені відповіді KeyCRM і готові сторінки,
// щоб нові фото й ціни зʼявились одразу, а не через годину.
export async function handleRefresh() {
  revalidateTag("catalog", { expire: 0 });
  revalidatePath("/", "layout");
  await send("🔄 Сайт оновлено. Відкрийте сторінку товару ще раз: перше відкриття підтягне свіжі дані з KeyCRM.");
}
