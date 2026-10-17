import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import kvTagCache from "@opennextjs/cloudflare/overrides/tag-cache/kv-next-tag-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

// Кеш сторінок у Cloudflare KV (безкоштовно), щоб каталог не тягнувся з KeyCRM на кожен запит.
const config = defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: kvTagCache,
  queue: memoryQueue,
});

// `npm run build` у Cloudflare сам викликає OpenNext, тож тут збираємо Next.js напряму, без рекурсії.
config.buildCommand = "npx next build";

export default config;
