export function formatPrice(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(Math.round(value)) + " грн";
}

/** Приводить номер до формату +380XXXXXXXXX або повертає null. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return "+38" + digits;
  if (digits.length === 12 && digits.startsWith("380")) return "+" + digits;
  return null;
}
