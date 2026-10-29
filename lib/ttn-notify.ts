import "server-only";
import { request } from "./keycrm";

// Відправлені замовлення, клієнтам яких ще не написали номер ТТН.
// «Надіслано» позначаємо тегом у KeyCRM, тож список не повторюється.

const SHIPPED_STATUS = "передано в доставку";
const SHIPPED_STATUS_ID = 8;
const SENT_TAG = "ттн надіслано";
const RECENT_DAYS = 4;

type Named = { id: number; name: string };
type KOrder = {
  id: number;
  updated_at?: string;
  buyer?: { full_name?: string; phone?: string } | null;
  shipping?: { delivery_service_id?: number | null; tracking_code?: string | null } | null;
  tags?: Named[] | null;
};
type List<T> = T[] | { data: T[] };
const rows = <T>(r: List<T>) => (Array.isArray(r) ? r : r.data);
const fresh = { cache: "no-store" as const };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type TtnNotice = { id: number; buyer: string; phone: string; ttn: string; nova: boolean };

async function sentTagId() {
  const tags = rows(await request<List<Named>>("/order/tag?limit=50", fresh));
  const id = tags.find((t) => norm(t.name) === SENT_TAG)?.id;
  if (!id) throw new Error("У KeyCRM немає тегу «ТТН надіслано». Створіть його в налаштуваннях тегів замовлень.");
  return id;
}

export async function ordersToNotify(): Promise<TtnNotice[]> {
  const statuses = rows(await request<List<Named>>("/order/status?limit=50", fresh));
  // Статус «Передано в доставку» у KeyCRM має номер 8; назву перевіряємо як запасний варіант.
  const shippedId =
    statuses.find((s) => norm(s.name) === SHIPPED_STATUS || /передан\S*\s+(в|у)\s+доставк/i.test(s.name))?.id ?? SHIPPED_STATUS_ID;
  const tagId = await sentTagId();
  const services = rows(await request<List<Named>>("/order/delivery-service?limit=50", fresh));
  const novaIds = new Set(services.filter((s) => /^нп$|нова\s*пошта/i.test(s.name.trim())).map((s) => s.id));

  const orders = rows(
    await request<List<KOrder>>(
      `/order?filter[status_id]=${shippedId}&include=buyer,shipping.deliveryService,tags&sort=-id&limit=50`,
      fresh,
    ),
  );
  // Час у KeyCRM в UTC: «2026-10-28 21:15:00».
  const since = Date.now() - RECENT_DAYS * 86400_000;
  return orders
    .filter((o) => o.shipping?.tracking_code && o.buyer?.phone)
    .filter((o) => !(o.tags ?? []).some((t) => t.id === tagId))
    .filter((o) => !o.updated_at || Date.parse(o.updated_at.replace(" ", "T") + "Z") >= since)
    .reverse()
    .map((o) => ({
      id: o.id,
      buyer: o.buyer?.full_name?.trim() || "",
      phone: o.buyer!.phone!,
      ttn: o.shipping!.tracking_code!.trim(),
      nova: novaIds.has(o.shipping?.delivery_service_id ?? -1),
    }));
}

export async function markSent(orderId: number) {
  await request(`/order/${orderId}/tag/${await sentTagId()}`, { method: "POST", ...fresh });
}

/** Номер для посилання у Viber: лише цифри, з кодом країни. */
export function viberDigits(phone: string) {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = "38" + d;
  return d;
}

export function customerText(n: TtnNotice) {
  const track = n.nova ? `\nВідстежити: https://novaposhta.ua/tracking/?cargo_number=${n.ttn}` : "";
  return `Доброго дня! Ваше замовлення відправлено ${n.nova ? "Новою Поштою" : "Укрпоштою"} 📦\nНомер ТТН: ${n.ttn}${track}\n\nДякуємо за покупку! SHEN`;
}
