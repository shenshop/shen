"use client";

import { useEffect, useState } from "react";

// Секунд до півночі за Києвом: таймер щодня починається заново о 00:00.
function secondsToMidnight() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return 86400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
}

const pad = (n: number) => String(n).padStart(2, "0");

export function SaleTimer() {
  // До запуску в браузері показуємо порожній блок тієї ж висоти, щоб сторінка не стрибала.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setLeft(secondsToMidnight());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="sale-timer" aria-live="off">
      <span>Знижка діє ще</span>
      <strong>
        {left == null
          ? "--:--:--"
          : `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`}
      </strong>
    </div>
  );
}
