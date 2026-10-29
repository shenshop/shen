"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "./cart";
import { PairDiscount } from "./pair-discount";
import { getUtm, track } from "./analytics";
import { sizeChartFor } from "@/data/sizes";
import { formatPrice } from "@/lib/format";
import type { DeliveryService } from "@/lib/types";

type City = { ref: string; name: string; area: string };
type Warehouse = { ref: string; name: string; number: string; postomat: boolean };

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CheckoutForm() {
  const { items, total, clear } = useCart();
  const router = useRouter();
  const [service, setService] = useState<DeliveryService>("novaposhta");
  const [payment, setPayment] = useState<"cod" | "prepay">("cod");
  const [city, setCity] = useState<City | null>(null);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useRef(false);

  useEffect(() => {
    if (items.length && !tracked.current) {
      tracked.current = true;
      track("InitiateCheckout", { value: total, currency: "UAH", num_items: items.length });
    }
  }, [items.length, total]);

  if (items.length === 0) {
    return (
      <div className="cart-empty">
        <p>У корзині поки порожньо</p>
        <Link href="/catalog" className="btn btn-dark">
          До каталогу
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);

    let delivery;
    if (service === "novaposhta") {
      if (!city || !warehouse) return setError("Оберіть місто та відділення Нової Пошти");
      delivery = { service, city: city.name, cityRef: city.ref, point: warehouse.name, warehouseRef: warehouse.ref };
    } else {
      delivery = {
        service,
        city: String(form.get("up_city") ?? ""),
        zip: String(form.get("up_zip") ?? ""),
        point: `Відділення ${form.get("up_zip") ?? ""}`,
      };
    }

    const comment = String(form.get("comment") ?? "").trim();

    setSending(true);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${form.get("last_name")} ${form.get("first_name")}`.trim(),
          phone: form.get("phone"),
          comment,
          website: form.get("website"),
          delivery,
          payment,
          items: items.map((i) => ({ sku: i.sku, name: i.name, size: i.size, price: i.price, quantity: i.quantity, image: i.image })),
          utm: getUtm(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      track(
        "Purchase",
        { value: data.total, currency: "UAH", content_ids: items.map((i) => i.sku), content_type: "product" },
        `order-${data.id}`,
      );
      clear();
      router.push(`/dyakuiemo?order=${data.id}`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Щось пішло не так. Спробуйте ще раз.");
      setSending(false);
    }
  }

  return (
    <form className="checkout" onSubmit={submit}>
      <div className="checkout-main">
        <fieldset>
          <legend>Отримувач</legend>
          <div className="field-row">
            <label className="field">
              <span>Імʼя</span>
              <input name="first_name" required autoComplete="given-name" />
            </label>
            <label className="field">
              <span>Прізвище</span>
              <input name="last_name" required autoComplete="family-name" />
            </label>
          </div>
          <label className="field">
            <span>Телефон</span>
            <input name="phone" required type="tel" inputMode="tel" placeholder="0XX XXX XX XX" autoComplete="tel" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Доставка</legend>
          <div className="options">
            <label className={service === "novaposhta" ? "option option-active" : "option"}>
              <input type="radio" name="service" checked={service === "novaposhta"} onChange={() => setService("novaposhta")} />
              <span>Нова Пошта</span>
              <small>відділення або поштомат</small>
            </label>
            <label className={service === "ukrposhta" ? "option option-active" : "option"}>
              <input type="radio" name="service" checked={service === "ukrposhta"} onChange={() => setService("ukrposhta")} />
              <span>Укрпошта</span>
              <small>у ваше відділення</small>
            </label>
          </div>

          {service === "novaposhta" ? (
            <>
              <CitySearch
                value={city}
                onChange={(c) => {
                  setCity(c);
                  setWarehouse(null);
                }}
              />
              {city && <WarehouseSearch cityRef={city.ref} value={warehouse} onChange={setWarehouse} />}
            </>
          ) : (
            <div className="field-row">
              <label className="field">
                <span>Місто або село</span>
                <input name="up_city" required />
              </label>
              <label className="field">
                <span>Індекс відділення</span>
                <input name="up_zip" required inputMode="numeric" pattern="[0-9]{5}" placeholder="01001" />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Розмір</legend>
          {/* Лише підказка про посадку; розмір Дрон уточнює з клієнтом у Viber. */}
          {items.map((i) => {
            const cm = sizeChartFor(i.name)[i.size];
            return (
              <p key={i.variantId} className="muted small fit-note">
                {items.length > 1 && <b>{i.name}, розмір {i.size}. </b>}
                Модель повномірна{cm ? `, ${i.size} = ${cm} см устілки` : ""}. Після замовлення ми ще уточнимо розмір у Viber.
              </p>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>Оплата</legend>
          <div className="options">
            <label className={payment === "cod" ? "option option-active" : "option"}>
              <input type="radio" name="payment" checked={payment === "cod"} onChange={() => setPayment("cod")} />
              <span>При отриманні</span>
              <small>оплата на пошті після примірки</small>
            </label>
            <label className={payment === "prepay" ? "option option-active" : "option"}>
              <input type="radio" name="payment" checked={payment === "prepay"} onChange={() => setPayment("prepay")} />
              <span>Передоплата на картку</span>
              <small>реквізити надішле менеджер</small>
            </label>
          </div>
        </fieldset>

        <label className="field">
          <span>Коментар (необовʼязково)</span>
          <textarea name="comment" rows={2} />
        </label>
        <input name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden />
      </div>

      <aside className="checkout-summary">
        <h2>Ваше замовлення</h2>
        <ul className="summary-list">
          {items.map((i) => (
            <li key={i.variantId}>
              <Image src={i.image} alt="" width={56} height={70} unoptimized={i.image.endsWith(".svg")} />
              <div>
                <p>{i.name}</p>
                <p className="muted small">
                  Розмір {i.size} · {i.quantity} шт.
                </p>
              </div>
              <strong>{formatPrice(i.price * i.quantity)}</strong>
            </li>
          ))}
        </ul>
        <PairDiscount />
        <div className="cart-total">
          <span>Разом</span>
          <strong>{formatPrice(total)}</strong>
        </div>
        <p className="muted small">Доставка оплачується за тарифами перевізника.</p>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-dark btn-block" disabled={sending}>
          {sending ? "Оформлюємо…" : "Підтвердити замовлення"}
        </button>
      </aside>
    </form>
  );
}

function CitySearch({ value, onChange }: { value: City | null; onChange: (c: City | null) => void }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<City[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = useDebounced(query);

  useEffect(() => {
    if (q.trim().length < 2 || value?.name === q) return setList([]);
    let cancelled = false;
    fetch(`/api/np/cities?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: City[]) => {
        if (!cancelled) {
          setList(data);
          setFailed(false);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [q, value]);

  return (
    <div className="field combo">
      <span>Місто</span>
      <input
        value={value ? value.name : query}
        placeholder="Почніть вводити назву"
        onChange={(e) => {
          onChange(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        required
      />
      {failed && <small className="error-text">Не вдалося завантажити список. Спробуйте ще раз.</small>}
      {open && list.length > 0 && !value && (
        <ul className="combo-list">
          {list.map((c) => (
            <li key={c.ref}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c);
                  setQuery(c.name);
                  setOpen(false);
                }}
              >
                {c.name} <span className="muted small">{c.area} обл.</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WarehouseSearch({ cityRef, value, onChange }: { cityRef: string; value: Warehouse | null; onChange: (w: Warehouse | null) => void }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Warehouse[]>([]);
  const [open, setOpen] = useState(false);
  const q = useDebounced(query, 250);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/np/warehouses?city=${cityRef}&q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Warehouse[]) => !cancelled && setList(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cityRef, q]);

  return (
    <div className="field combo">
      <span>Відділення або поштомат</span>
      <input
        value={value ? value.name : query}
        placeholder="Номер або адреса"
        onChange={(e) => {
          onChange(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
        required
      />
      {open && !value && list.length > 0 && (
        <ul className="combo-list">
          {list.map((w) => (
            <li key={w.ref}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(w);
                  setOpen(false);
                }}
              >
                {w.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
