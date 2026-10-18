"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function Gallery({ images, name }: { images: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const go = (i: number) => {
    setIndex(i);
    const el = track.current;
    if (el) el.scrollTo({ left: el.clientWidth * i, behavior: "smooth" });
  };

  useEffect(() => {
    const show = (e: Event) => {
      const i = images.indexOf((e as CustomEvent<string | undefined>).detail ?? "");
      if (i >= 0) go(i);
    };
    window.addEventListener("shen:show-image", show);
    return () => window.removeEventListener("shen:show-image", show);
  });

  return (
    <div className="gallery">
      <div
        className="gallery-track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== index) setIndex(i);
        }}
      >
        {images.map((src, i) => (
          <div className="gallery-slide" key={src}>
            <Image
              src={src}
              alt={`${name}, фото ${i + 1}`}
              fill
              priority={i === 0}
              sizes="(max-width: 900px) 100vw, 55vw"
              unoptimized={src.endsWith(".svg")}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs">
          {images.map((src, i) => (
            <button key={src} className={i === index ? "thumb thumb-active" : "thumb"} onClick={() => go(i)} aria-label={`Фото ${i + 1}`}>
              <Image src={src} alt="" width={72} height={90} unoptimized={src.endsWith(".svg")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
