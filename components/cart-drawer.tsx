"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useCart } from "./cart";
import { CloseIcon, MinusIcon, PlusIcon } from "./icons";
import { formatPrice } from "@/lib/format";

export function CartDrawer() {
  const { items, total, open, setOpen, setQuantity, remove } = useCart();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={() => setOpen(false)}>
      <aside className="sheet sheet-right" onClick={(e) => e.stopPropagation()} aria-label="Корзина">
        <div className="sheet-head">
          <h2>Корзина</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрити">
            <CloseIcon />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cart-empty">
            <p>У корзині поки порожньо</p>
            <Link href="/catalog" className="btn btn-dark" onClick={() => setOpen(false)}>
              До каталогу
            </Link>
          </div>
        ) : (
          <>
            <ul className="cart-list">
              {items.map((item) => (
                <li key={item.variantId} className="cart-item">
                  <Image src={item.image} alt={item.name} width={80} height={100} unoptimized={item.image.endsWith(".svg")} />
                  <div className="cart-item-body">
                    <p className="cart-item-name">{item.name}</p>
                    <p className="muted">Розмір {item.size}</p>
                    <div className="cart-item-row">
                      <div className="qty">
                        <button onClick={() => setQuantity(item.variantId, item.quantity - 1)} aria-label="Менше">
                          <MinusIcon />
                        </button>
                        <span>{item.quantity}</span>
                        <button onClick={() => setQuantity(item.variantId, item.quantity + 1)} aria-label="Більше">
                          <PlusIcon />
                        </button>
                      </div>
                      <strong>{formatPrice(item.price * item.quantity)}</strong>
                    </div>
                    <button className="link-btn" onClick={() => remove(item.variantId)}>
                      Видалити
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="cart-foot">
              <div className="cart-total">
                <span>Разом</span>
                <strong>{formatPrice(total)}</strong>
              </div>
              <p className="muted small">Доставка за тарифами перевізника</p>
              <Link href="/checkout" className="btn btn-dark btn-block" onClick={() => setOpen(false)}>
                Оформити замовлення
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
