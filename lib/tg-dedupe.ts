import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Telegram надсилає те саме оновлення ще раз, якщо бот не відповів швидко (наприклад, коли KeyCRM
// просить зачекати через ліміт 20 запитів/хв). Без цього кнопка спрацьовувала двічі й список дублювався.
type KV = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };

/** true — це оновлення вже обробляється або оброблене, пропускаємо. */
export async function seenUpdate(bot: string, updateId: number | undefined) {
  if (!updateId) return false;
  const kv = (getCloudflareContext().env as unknown as { NEXT_INC_CACHE_KV: KV }).NEXT_INC_CACHE_KV;
  const key = `tg:upd:${bot}:${updateId}`;
  if (await kv.get(key)) return true;
  await kv.put(key, "1", { expirationTtl: 60 * 60 * 24 });
  return false;
}
