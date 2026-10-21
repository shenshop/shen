import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

// Миттєве оновлення каталогу після змін у KeyCRM: відкрити /api/revalidate?secret=...
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Невірний ключ" }, { status: 401 });
  }
  // Скидаємо і збережені відповіді KeyCRM, і готові сторінки.
  revalidateTag("catalog", { expire: 0 });
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, message: "Каталог оновлено" });
}
