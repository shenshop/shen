import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = { title: "Оформлення замовлення", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <section className="container section">
      <h1 className="page-title">Оформлення замовлення</h1>
      <CheckoutForm />
    </section>
  );
}
