"use client";
import { useEffect } from "react";

// Поки відкрите вікно (таблиця розмірів, швидке замовлення, меню, корзина), сторінка під ним не гортається.
let locks = 0;
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    // Фіксуємо body на місці й потім повертаємо прокрутку туди, де вона була (так працює і в iPhone).
    const body = document.body;
    if (locks++ === 0) {
      body.style.top = `-${window.scrollY}px`;
      body.classList.add("scroll-lock");
    }
    return () => {
      if (--locks > 0) return;
      const y = -parseInt(body.style.top || "0", 10);
      body.classList.remove("scroll-lock");
      body.style.top = "";
      window.scrollTo({ top: y, behavior: "instant" });
    };
  }, [active]);
}
