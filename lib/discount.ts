import { settings } from "@/data/settings";

/** Знижка за другу пару: один раз на замовлення, коли в ньому 2 пари або більше. */
export const pairDiscount = (pairs: number) => (pairs >= 2 ? settings.secondPairDiscount : 0);
