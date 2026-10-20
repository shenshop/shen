"use client";

import Link from "next/link";
import { useState } from "react";
import { useScrollLock } from "@/lib/scroll-lock";
import { useCart } from "./cart";
import { BagIcon, CloseIcon, MenuIcon } from "./icons";
import type { Category } from "@/lib/types";

export function Header({ categories, shopName, contacts }: { categories: Category[]; shopName: string; contacts: React.ReactNode }) {
  const { count, setOpen } = useCart();
  const [menu, setMenu] = useState(false);
  useScrollLock(menu);
  const roots = categories.filter((c) => c.parentId == null);

  return (
    <header className="header">
      <div className="container header-inner">
        <button className="icon-btn only-mobile" onClick={() => setMenu(true)} aria-label="Меню">
          <MenuIcon />
        </button>
        <Link href="/" className="logo" aria-label="На головну">
          {shopName}
        </Link>
        <nav className="nav only-desktop">
          {roots.map((c) => (
            <Link key={c.id} href={`/catalog/${c.slug}`}>
              {c.name}
            </Link>
          ))}
          <Link href="/catalog">Весь каталог</Link>
          <Link href="/#vidguky">Відгуки</Link>
        </nav>
        <button className="icon-btn cart-btn" onClick={() => setOpen(true)} aria-label={`Корзина, товарів: ${count}`}>
          <BagIcon />
          {count > 0 && <span className="badge">{count}</span>}
        </button>
      </div>

      {menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(false)}>
          <aside className="sheet sheet-left" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <span className="logo">{shopName}</span>
              <button className="icon-btn" onClick={() => setMenu(false)} aria-label="Закрити">
                <CloseIcon />
              </button>
            </div>
            <nav className="mobile-nav" onClick={() => setMenu(false)}>
              <Link href="/catalog">Весь каталог</Link>
              {roots.map((root) => (
                <div key={root.id}>
                  <Link href={`/catalog/${root.slug}`} className="mobile-nav-root">
                    {root.name}
                  </Link>
                  {categories
                    .filter((c) => c.parentId === root.id)
                    .map((c) => (
                      <Link key={c.id} href={`/catalog/${c.slug}`} className="mobile-nav-sub">
                        {c.name}
                      </Link>
                    ))}
                </div>
              ))}
              <Link href="/#vidguky">Відгуки</Link>
              <Link href="/#kontakty">Звʼязок</Link>
            </nav>
            {contacts}
          </aside>
        </div>
      )}
    </header>
  );
}
