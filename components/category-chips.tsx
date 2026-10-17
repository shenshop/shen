import Link from "next/link";
import type { Category } from "@/lib/types";

export function CategoryChips({ categories, active }: { categories: Category[]; active?: number }) {
  return (
    <div className="chips">
      <Link href="/catalog" className={active ? "chip" : "chip chip-active"}>
        Усі
      </Link>
      {categories.map((c) => (
        <Link key={c.id} href={`/catalog/${c.slug}`} className={c.id === active ? "chip chip-active" : "chip"}>
          {c.name}
        </Link>
      ))}
    </div>
  );
}
