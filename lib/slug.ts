const map: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z",
  и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "ʼ": "", ы: "y", э: "e", ё: "e", ъ: "",
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Адреса товару: "12-krosivky-shkiriani". Шукаємо товар за числом на початку. */
export function productSlug(id: number, name: string): string {
  return `${id}-${slugify(name)}`;
}

export function idFromSlug(slug: string): number | null {
  const id = parseInt(slug, 10);
  return Number.isFinite(id) ? id : null;
}
