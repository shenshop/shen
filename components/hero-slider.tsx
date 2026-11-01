"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";

type Slide = { slug: string; name: string; image: string; price: number };

// Головне фото на першій сторінці: кілька хітів, що самі гортаються кожні 4 секунди.
// Гортати можна й пальцем; після дотику автогортання на хвилину зупиняється.
export function HeroSlider({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const pausedUntil = useRef(0);

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      const el = track.current;
      if (!el || Date.now() < pausedUntil.current || document.hidden) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      go(next);
    }, 4000);
    return () => clearInterval(timer);
  }, [slides.length]);

  const pause = () => (pausedUntil.current = Date.now() + 60_000);

  return (
    <div className="hero-slider">
      <div
        className="hero-track"
        ref={track}
        onTouchStart={pause}
        onMouseDown={pause}
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
      >
        {slides.map((s, i) => (
          <Link key={s.slug} href={`/product/${s.slug}`} className="hero-slide" aria-label={s.name}>
            <span className="hero-photo">
            <Image
              src={s.image}
              alt={s.name}
              fill
              priority={i === 0}
              loading={i === 0 ? undefined : "lazy"}
              sizes="(max-width: 800px) 100vw, 50vw"
              unoptimized={s.image.endsWith(".svg")}
            />
            </span>
            <span className="hero-caption">
              <span>{s.name}</span>
              <strong>{formatPrice(s.price)}</strong>
            </span>
          </Link>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="hero-dots">
          {slides.map((s, i) => (
            <button
              key={s.slug}
              type="button"
              aria-label={`Фото ${i + 1}`}
              className={i === active ? "is-active" : ""}
              onClick={() => {
                pause();
                go(i);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
