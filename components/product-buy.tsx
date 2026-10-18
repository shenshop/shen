"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "./cart";
import { getUtm, track } from "./analytics";
import { CloseIcon } from "./icons";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/lib/types";
import { colorsOf, itemName } from "@/lib/variants";
import { ColorPicker } from "./color-picker";

// Орієнтовна довжина стопи для європейської розмірної сітки.
const footLength: Record<string, string> = {
  "35": "22.5", "36": "23", "37": "23.5–24", "38": "24.5", "39": "25", "40": "25.5–26",
  "41": "26.5", "42": "27", "43": "27.5–28", "44": "28.5", "45": "29", "46": "29.5–30",
};

export function ProductBuy({ product }: { product: Product }) {
  const { add, setOpen } = useCart();
  const router = useRouter();
  const [variantId, setVariantId] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [quick, setQuick] = useState(false);
  const [guide, setGuide] = useState(false);
  const colors = colorsOf(product);
  const [color, setColor] = useState(colors[0] ?? "");
  const shown = colors.length ? product.variants.filter((v) => v.color === color) : product.variants;
  const variant = product.variants.find((v) => v.id === variantId) ?? null;

  useEffect(() => {
    track("ViewContent", { content_ids: product.variants.map((v) => v.sku), content_name: product.name, content_type: "product", value: product.price, currency: "UAH" });
  }, [product]);

  const requireSize = () => {
    if (variant) return variant;
    setError(true);
    document.getElementById("sizes")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return null;
  };

  const addToCart = (openCheckout: boolean) => {
    const v = requireSize();
    if (!v) return;
    add({ productId: product.id, variantId: v.id, sku: v.sku, name: itemName(product, v), size: v.size, price: v.price, image: product.images[0] });
    track("AddToCart", { content_ids: [v.sku], content_type: "product", value: v.price, currency: "UAH" });
    if (openCheckout) router.push("/checkout");
    else setOpen(true);
  };

  return (
    <div className="buy">
      <div className="sizes-head">
        <span>Розмір{variant ? `: ${variant.size}` : ""}</span>
        <button className="link-btn" onClick={() => setGuide(true)}>
          Таблиця розмірів
        </button>
      </div>
      <ColorPicker
        colors={colors}
        value={color}
        onChange={(c) => {
          setColor(c);
          setVariantId(null);
        }}
      />
      <div id="sizes" className={error ? "sizes sizes-error" : "sizes"}>
        {shown.map((v) => (
          <button
            key={v.id}
            className={v.id === variantId ? "size size-active" : "size"}
            disabled={!v.inStock}
            onClick={() => {
              setVariantId(v.id);
              setError(false);
            }}
          >
            {v.size}
          </button>
        ))}
      </div>
      {error && <p className="error-text">Оберіть розмір</p>}

      <div className="buy-actions">
        <button className="btn btn-dark btn-block" onClick={() => addToCart(true)}>
          Купити{variant ? ` · ${formatPrice(variant.price)}` : ""}
        </button>
        <div className="buy-row">
          <button className="btn btn-light" onClick={() => addToCart(false)}>
            В корзину
          </button>
          <button
            className="btn btn-light"
            onClick={() => {
              if (requireSize()) setQuick(true);
            }}
          >
            Швидке замовлення
          </button>
        </div>
      </div>

      <div className="sticky-buy only-mobile">
        <div>
          <strong>{formatPrice(variant?.price ?? product.price)}</strong>
          <span className="muted small">{variant ? `Розмір ${variant.size}` : "Оберіть розмір"}</span>
        </div>
        <button className="btn btn-dark" onClick={() => addToCart(true)}>
          Купити
        </button>
      </div>

      {quick && variant && <QuickOrder product={product} variant={variant} onClose={() => setQuick(false)} />}

      {guide && (
        <div className="modal-backdrop" onClick={() => setGuide(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>Таблиця розмірів</h2>
              <button className="icon-btn" onClick={() => setGuide(false)} aria-label="Закрити">
                <CloseIcon />
              </button>
            </div>
            <p className="muted small">Поставте стопу на аркуш паперу, обведіть і виміряйте від пʼятки до найдовшого пальця.</p>
            <table className="size-table">
              <thead>
                <tr>
                  <th>Розмір</th>
                  <th>Довжина стопи, см</th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((v) => (
                  <tr key={v.id}>
                    <td>{v.size}</td>
                    <td>{footLength[v.size] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Не впевнені? Напишіть нам, підкажемо. Якщо не підійде, обміняємо протягом 14 днів.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function QuickOrder({ product, variant, onClose }: { product: Product; variant: Product["variants"][number]; onClose: () => void }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quick: true,
          name: form.get("name"),
          phone: form.get("phone"),
          website: form.get("website"),
          payment: "cod",
          items: [{ sku: variant.sku, name: itemName(product, variant), size: variant.size, price: variant.price, quantity: 1, image: product.images[0] }],
          utm: getUtm(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      track("Purchase", { value: data.total, currency: "UAH", content_ids: [variant.sku], content_type: "product" }, `order-${data.id}`);
      router.push(`/dyakuiemo?order=${data.id}&quick=1`);
    } catch (err) {
      setMessage(err instanceof Error && err.message ? err.message : "Щось пішло не так. Спробуйте ще раз.");
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="sheet-head">
          <h2>Швидке замовлення</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрити">
            <CloseIcon />
          </button>
        </div>
        <p className="muted small">
          {itemName(product, variant)}, розмір {variant.size}, {formatPrice(variant.price)}. Залиште номер, і ми передзвонимо, щоб уточнити доставку.
        </p>
        <label className="field">
          <span>Імʼя</span>
          <input name="name" required minLength={2} autoComplete="name" />
        </label>
        <label className="field">
          <span>Телефон</span>
          <input name="phone" required type="tel" inputMode="tel" placeholder="0XX XXX XX XX" autoComplete="tel" />
        </label>
        <input name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden />
        {message && <p className="error-text">{message}</p>}
        <button className="btn btn-dark btn-block" disabled={sending}>
          {sending ? "Надсилаємо…" : "Замовити"}
        </button>
      </form>
    </div>
  );
}
