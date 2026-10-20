// Точка входу Worker у Cloudflare: обгортка над тим, що збирає OpenNext.
// Стиснені фото (/_next/image) кешуємо на 30 днів, щоб кожен новий відвідувач
// не чекав, поки фото завантажиться з KeyCRM і стиснеться заново.
import handler from "./.open-next/worker.js";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const IMAGE_TTL = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/_next/image" || request.method !== "GET") return handler.fetch(request, env, ctx);

    // Формат (avif/webp/jpeg) залежить від браузера, тому він входить у ключ кешу.
    const accept = request.headers.get("Accept") ?? "";
    const format = accept.includes("image/avif") ? "avif" : accept.includes("image/webp") ? "webp" : "orig";
    const key = new Request(`${url.origin}/_next/image${url.search}&cache-format=${format}`);
    const cache = caches.default;
    const cached = await cache.match(key);
    if (cached) return cached;

    const res = await handler.fetch(request, env, ctx);
    if (!res.ok) return res;
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", `public, max-age=${IMAGE_TTL}`);
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  },
};
