import { NextResponse } from "next/server";
import { searchCities } from "@/lib/novaposhta";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchCities(q));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не вдалося завантажити міста" }, { status: 502 });
  }
}
