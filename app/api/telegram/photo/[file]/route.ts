import { photoSignature } from "@/lib/new-product";

export const dynamic = "force-dynamic";

// Фото, яке Дрон надіслав боту, для KeyCRM: KeyCRM забирає картинку за посиланням.
// Пряме посилання Telegram містить токен бота, тому віддаємо фото через сайт і лише з підписом.
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const fileId = decodeURIComponent((await params).file).replace(/\.jpg$/, "");
  const sig = new URL(req.url).searchParams.get("s");
  if (!sig || sig !== (await photoSignature(fileId))) return new Response("Not found", { status: 404 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const info = (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`).then((r) => r.json())) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  if (!info.ok || !info.result?.file_path) return new Response("Not found", { status: 404 });
  const file = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
  if (!file.ok || !file.body) return new Response("Not found", { status: 404 });
  return new Response(file.body, {
    headers: { "Content-Type": file.headers.get("content-type")?.startsWith("image/") ? file.headers.get("content-type")! : "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
