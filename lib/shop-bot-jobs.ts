import "server-only";
import { customerText, markSent, ordersToNotify } from "./ttn-notify";
import { markReminded, pickupText, pickupsWaiting } from "./pickup-reminder";
import { chatForOrder, notifyOrderChat, shopBotEnabled } from "./shop-bot";
import { esc, telegram } from "./telegram";

// Клієнтам, які підключили бот, ТТН і нагадування бот надсилає сам і ставить ті самі теги в KeyCRM,
// що й кнопки «Надіслано» / «Написав». Решту Дрон бачить у списках, як раніше.

/** ТТН у бот тим, хто його підключив. Повертає номери замовлень, яким надіслано. */
export async function autoSendTtns(list?: Awaited<ReturnType<typeof ordersToNotify>>) {
  if (!shopBotEnabled()) return [];
  const done: number[] = [];
  for (const n of list ?? (await ordersToNotify())) {
    if (!(await chatForOrder(n.id))) continue;
    if (await notifyOrderChat(n.id, customerText(n))) {
      await markSent(n.id);
      done.push(n.id);
    }
  }
  if (done.length) await telegram("sendMessage", { text: `📮 ТТН надіслано клієнтам у Telegram автоматично: ${done.map((id) => `№${id}`).join(", ")}` });
  return done;
}

export async function autoSendPickups(list?: Awaited<ReturnType<typeof pickupsWaiting>>) {
  if (!shopBotEnabled()) return [];
  const done: number[] = [];
  for (const p of list ?? (await pickupsWaiting())) {
    if (!(await chatForOrder(p.id))) continue;
    if (await notifyOrderChat(p.id, pickupText(p))) {
      await markReminded(p.id, p.final);
      done.push(p.id);
    }
  }
  if (done.length) await telegram("sendMessage", { text: `📬 Нагадали забрати посилку в Telegram автоматично: ${esc(done.map((id) => `№${id}`).join(", "))}` });
  return done;
}
