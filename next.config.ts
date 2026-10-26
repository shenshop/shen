import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  images: {
    // Фото товарів приходять із KeyCRM (їхнє сховище), тому дозволяємо зовнішні https-зображення.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Стилі вбудовуються прямо в сторінку: без окремого CSS-файлу сторінка не може відкритись «голою».
    inlineCss: true,
  },
};

export default nextConfig;

// Дає доступ до Cloudflare-привʼязок (KV тощо) під час `npm run dev`.
initOpenNextCloudflareForDev();
