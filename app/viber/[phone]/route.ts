// Перехід з Telegram у чат Viber з клієнтом: Telegram не відкриває посилання viber:// напряму.
export async function GET(_req: Request, { params }: { params: Promise<{ phone: string }> }) {
  const digits = (await params).phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return new Response("Невірний номер", { status: 400 });
  const link = `viber://chat?number=%2B${digits}`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Viber</title><meta name="robots" content="noindex">
<body style="font-family:system-ui;text-align:center;padding:40px 16px">
<p><a href="${link}" style="display:inline-block;background:#7360f2;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-size:18px">Відкрити чат у Viber</a></p>
<p style="color:#777">+${digits}</p>
<script>location.href=${JSON.stringify(link)}</script></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
