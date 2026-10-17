// Одна команда `npm run build` для будь-якого хостингу:
// у Cloudflare (WORKERS_CI=1) збираємо Worker через OpenNext, деінде (Vercel, VPS) звичайний `next build`.
import { execSync } from "node:child_process";

const cmd = process.env.WORKERS_CI ? "npx opennextjs-cloudflare build" : "npx next build";
console.log(`> ${cmd}`);
execSync(cmd, { stdio: "inherit" });
