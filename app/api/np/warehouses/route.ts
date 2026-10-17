import { NextResponse } from "next/server";
import { searchWarehouses } from "@/lib/novaposhta";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const city = params.get("city") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(city)) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchWarehouses(city, params.get("q")?.trim() ?? ""));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не вдалося завантажити відділення" }, { status: 502 });
  }
}
