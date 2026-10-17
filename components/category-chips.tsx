import Link from "next/link";
import type { Category } from "@/lib/types";

/** Головні категорії, а коли одна з них відкрита, ще й її підкатегорії (щоб не було двох «Кросівок» поруч). */
export function CategoryChips({ categories, active }: { categories: Category[]; active?: number }) {
  const current = categories.find((c) => c.id === active);
  const rootId = current ? (current.parentId ?? current.id) : null;
  const visible = categories.filter((c) => c.parentId == null || (rootId != null && c.parentId === rootId));
  return (
    <div className="chips">
      <Link href="/catalog" className={active ? "chip" : "chip chip-active"}>
        Усі
      </Link>
      {visible.map((c) => (
        <Link key={c.id} href={`/catalog/${c.slug}`} className={c.id === active ? "chip chip-active" : "chip"}>
          {c.name}
        </Link>
      ))}
    </div>
  );
}
