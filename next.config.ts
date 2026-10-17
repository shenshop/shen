import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Фото товарів приходять із KeyCRM (їхнє сховище), тому дозволяємо зовнішні https-зображення.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
