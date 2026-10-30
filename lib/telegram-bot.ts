import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { esc, telegram } from "./telegram";
import { buildPlan, MAX_MOVES, moveOrders, type PlannedOrder } from "./stock-check";
import { customerText, markSent, ordersToNotify, stats, viberDigits } from "./ttn-notify";
import { REASONS, refusals, refusalText, saveRefusalReason } from "./refusals";
import { pickupsWaiting, pickupText } from "./pickup-reminder";
import { createManualOrder, parseManualOrder } from "./manual-order";
import { createNewProduct, findProduct, groupPhotos, MAX_PHOTOS, parseNewProduct, photoUpdateSku, photoUrl, replacePhotos } from "./new-product";
import { formatPrice } from "./format";

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
          ], [
            ...Object.entries(REASONS).map(([code, label]) => ({ text: label, callback_data: `why:${r.id}:${code}` })),
            { text: "✍️ Своя", callback_data: `why:${r.id}:own` },
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

// Причина відмови: кнопка з готовою причиною або «Своя» — тоді бот просить написати текст у відповідь.
export const REASON_PROMPT = /Причина відмови №(\d+)/;

export async function handleReasonButton(orderId: number, code: string) {
  if (code === "own") {
    return send(`✍️ Причина відмови №${orderId}: напишіть у відповідь на це повідомлення.`, {
      reply_markup: { force_reply: true, input_field_placeholder: "Наприклад: замала колодка" },
    });
  }
  const reason = REASONS[code];
  if (reason) await handleReasonText(orderId, reason);
}

export async function handleReasonText(orderId: number, reason: string) {
  await saveRefusalReason(orderId, reason);
  await send(`📝 №${orderId}: записав у KeyCRM «Причина відмови: ${esc(reason.trim())}».`);
}

// Замовлення з повідомлення: спершу перевірка з кнопками, а створюємо лише після «Так».
// Перевірка йде відповіддю на повідомлення Дрона, тож на «Так» беремо текст звідти і розбираємо ще раз.
export async function handleManualPreview(text: string, messageId: number) {
  const { order, error } = await parseManualOrder(text);
  if (!order) return send(`⚠️ Замовлення не створено. ${esc(error ?? "")}`, { reply_parameters: { message_id: messageId } });
  const total = order.items.reduce((s, i) => s + i.price, 0);
  await send(
    [
      "🧾 <b>Перевірте замовлення (джерело «Дзвінок»):</b>",
      `👤 ${esc(order.name)}`,
      `📞 ${esc(order.phone)}`,
      `🚚 Нова Пошта: ${esc(order.city)}, ${esc(order.warehouse.name)}`,
      ...order.items.map((i) => `• ${esc(i.name)}, розмір ${esc(i.size)} (${esc(i.sku)}) = ${formatPrice(i.price)}`),
      `<b>Разом: ${formatPrice(total)}</b>, накладений платіж`,
    ].join("\n"),
    {
      reply_parameters: { message_id: messageId },
      reply_markup: { inline_keyboard: [[{ text: "✅ Створити в KeyCRM", callback_data: "mkorder" }, { text: "Ні", callback_data: "cancel" }]] },
    },
  );
}

export async function handleManualCreate(originalText: string) {
  const { order, error } = await parseManualOrder(originalText);
  if (!order) return send(`⚠️ Замовлення не створено. ${esc(error ?? "")}`);
  const created = await createManualOrder(order);
  await send(`✅ Замовлення №${created.id} створено в KeyCRM: ${esc(order.name)}, ${order.items.length} ${order.items.length === 1 ? "пара" : order.items.length < 5 ? "пари" : "пар"}.`);
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

// Новий товар: фото альбомом з підписом (або просто текст). Спершу перевірка, створюємо після «Створити».
// group — альбом, з якого беремо фото; на кнопці він записаний, а підпис беремо з повідомлення Дрона.
export async function handleProductPreview(text: string, messageId: number, group: string | null) {
  const { product, error } = await parseNewProduct(text);
  if (!product) return send(`⚠️ Товар не створено. ${esc(error ?? "")}`, { reply_parameters: { message_id: messageId } });
  const photos = group ? await groupPhotos(group, messageId) : [];
  await send(
    [
      product.existingId
        ? `👟 <b>Товар з артикулом ${esc(product.sku)} уже є в KeyCRM без розмірів (ID ${product.existingId}). Додам у нього розміри:</b>`
        : "👟 <b>Перевірте новий товар для KeyCRM:</b>",
      `<b>${esc(product.name)}</b>`,
      `Артикул: ${esc(product.sku)}`,
      `Розміри: ${product.sizes.join(", ")} (артикули ${esc(product.sku)}-${product.sizes[0]} … ${esc(product.sku)}-${product.sizes.at(-1)})`,
      `Ціна: ${formatPrice(product.price)}, закупка ${formatPrice(product.purchasedPrice)}`,
      "Коробка: 2000 г, 30×20×20 см",
      product.category ? `Категорія: ${esc(product.category.name)}` : "Категорія: без категорії",
      group
        ? `Фото: ${photos.length}${photos.length < 2 ? " (решта фото альбому підтягнеться при створенні)" : ""}, перше фото і в кожному розмірі`
        : "Фото: немає (надішліть фото альбомом з цим текстом у підписі)",
      "Галочка «На сайт»: так",
      `\nОпис:\n${esc(product.description)}`,
    ].join("\n"),
    {
      reply_parameters: { message_id: messageId },
      reply_markup: { inline_keyboard: [[{ text: "✅ Створити в KeyCRM", callback_data: `mkprod:${group ?? ""}` }, { text: "Ні", callback_data: "cancel" }]] },
    },
  );
}

export async function handleProductCreate(originalText: string, group: string, origin: string, captionId?: number) {
  const { product, error } = await parseNewProduct(originalText);
  if (!product) return send(`⚠️ Товар не створено. ${esc(error ?? "")}`);
  const pictures = group ? await Promise.all((await groupPhotos(group, captionId)).map((id) => photoUrl(origin, id))) : [];
  const r = await createNewProduct(product, pictures);
  if (!r.checked) {
    return send(
      `✅ Товар «${esc(product.name)}» ${r.reused ? "доповнено розмірами" : "створено"} в KeyCRM (ID ${r.id}), але KeyCRM ще не віддає його для перевірки. Гляньте картку: розміри, фото, «На сайт».`,
    );
  }
  const warn = [
    r.sizes.length !== product.sizes.length ? `⚠️ Розмірів збереглося ${r.sizes.length} з ${product.sizes.length}.` : "",
    !r.reused && r.photos < pictures.length ? `⚠️ Фото збереглося ${r.photos} з ${pictures.length}.` : "",
    pictures.length && r.sizePhotos < r.sizes.length ? `⚠️ Фото є в ${r.sizePhotos} розмірах з ${r.sizes.length}.` : "",
    r.blank ? "⚠️ У картці лишився варіант без розміру, видаліть його вручну." : "",
    r.onSite ? "" : "⚠️ Галочка «На сайт» не поставилась, поставте її в картці вручну.",
  ].filter(Boolean);
  await send(
    [
      `✅ Товар «${esc(product.name)}» ${r.reused ? "доповнено розмірами" : "створено"} в KeyCRM (ID ${r.id}).`,
      `Розміри: ${r.sizes.join(", ") || "—"} · фото: ${r.photos} (у розмірах: ${r.sizePhotos}) · на сайт: ${r.onSite ? "так" : "ні"}`,
      ...warn,
      "",
      `На сайті зʼявиться протягом години, або одразу після «${REFRESH_BUTTON}».`,
    ].join("\n"),
  );
}

// Заміна фото в наявному товарі: перевірка з кнопкою, міняємо після «Замінити».
export async function handlePhotoPreview(caption: string, messageId: number, group: string) {
  const sku = photoUpdateSku(caption);
  if (!sku) return;
  const { product, offers, error } = await findProduct(sku);
  if (!product) return send(`⚠️ Фото не замінено. ${esc(error ?? "")}`, { reply_parameters: { message_id: messageId } });
  const photos = await groupPhotos(group, messageId);
  await send(
    [
      `🖼 <b>Замінити фото в товарі?</b>`,
      `<b>${esc(product.name)}</b> (ID ${product.id})`,
      `Зараз у картці фото: ${product.attachments_data?.length ?? 0}, розмірів: ${offers?.length ?? 0}`,
      `Нові фото: ${photos.length}${photos.length < 2 ? " (решта фото альбому підтягнеться при заміні)" : ""}, максимум ${MAX_PHOTOS}`,
      "Старі фото картки зміняться на нові, перше фото стане головним і стоятиме в усіх розмірах.",
    ].join("\n"),
    {
      reply_parameters: { message_id: messageId },
      reply_markup: { inline_keyboard: [[{ text: "✅ Замінити", callback_data: `mkphoto:${group}` }, { text: "Ні", callback_data: "cancel" }]] },
    },
  );
}

export async function handlePhotoReplace(caption: string, group: string, origin: string, captionId?: number) {
  const sku = photoUpdateSku(caption);
  const { product, error } = sku ? await findProduct(sku) : { product: undefined, error: "Не бачу артикула в підписі." };
  if (!product) return send(`⚠️ Фото не замінено. ${esc(error ?? "")}`);
  const pictures = await Promise.all((await groupPhotos(group, captionId)).map((id) => photoUrl(origin, id)));
  if (!pictures.length) return send("⚠️ Не бачу фото альбому. Надішліть альбом з підписом ще раз.");
  const r = await replacePhotos(product.id, pictures);
  await send(
    [
      `✅ Фото в «${esc(product.name)}» замінено.`,
      `У картці: ${r.photos ?? "?"} з ${pictures.length} · у розмірах: ${r.sizePhotos} з ${r.sizes}`,
      r.photos != null && r.photos < pictures.length ? "⚠️ Не всі фото збереглися, гляньте картку." : "",
      "",
      `На сайті оновиться протягом години, або одразу після «${REFRESH_BUTTON}».`,
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
  );
}
