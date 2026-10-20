// Основна адреса сайту: Google показує саме її, навіть якщо сторінку відкрили з іншої адреси.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://khoda.com.ua").replace(/\/$/, "");

export const siteUrl = (path: string) => SITE_URL + path;
