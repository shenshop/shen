"use client";

import { useState } from "react";

/** Плаваюча кнопка «Написати нам»: відкриває список месенджерів. */
export function ChatButton({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!links.length) return null;
  return (
    <div className={open ? "chat-fab chat-fab-open" : "chat-fab"}>
      {open && (
        <div className="chat-menu">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </div>
      )}
      <button type="button" className="chat-toggle" aria-expanded={open} aria-label="Написати нам" onClick={() => setOpen(!open)}>
        {open ? (
          "✕"
        ) : (
          <>
            💬<span className="chat-toggle-text"> Написати нам</span>
          </>
        )}
      </button>
    </div>
  );
}
