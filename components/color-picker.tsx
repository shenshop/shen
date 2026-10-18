"use client";

export function ColorPicker({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  if (!colors.length) return null;
  return (
    <div className="colors">
      {colors.map((c) => (
        <button key={c} className={c === value ? "color-chip size-active" : "color-chip"} onClick={() => onChange(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
