import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart";
import { Header } from "@/components/header";
import { CartDrawer } from "@/components/cart-drawer";
import { Analytics } from "@/components/analytics";
import { getCatalog } from "@/lib/catalog";

const font = Manrope({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://shen-shop.com.ua"),
  title: { default: "SHEN — взуття з натуральної шкіри", template: "%s — SHEN" },
  description: "Жіноче та чоловіче взуття з натуральної шкіри. Доставка Новою Поштою та Укрпоштою, оплата при отриманні, обмін 14 днів.",
};

export const viewport: Viewport = { themeColor: "#faf8f5", width: "device-width", initialScale: 1 };

const phone = process.env.NEXT_PUBLIC_PHONE ?? "+380738113785";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { categories } = await getCatalog();
  return (
    <html lang="uk" className={font.variable}>
      <body>
        <CartProvider>
          <Header categories={categories} />
          <main>{children}</main>
          <footer className="footer" id="kontakty">
            <div className="container footer-inner">
              <div>
                <p className="logo">SHEN</p>
                <p className="muted">Взуття з натуральної шкіри</p>
              </div>
              <div className="footer-contacts">
                <a href={`tel:${phone}`}>{phone.replace(/^\+38(\d{3})(\d{3})(\d{2})(\d{2})$/, "+38 $1 $2 $3 $4")}</a>
                <a href={`viber://chat?number=${encodeURIComponent(phone)}`}>Viber</a>
                <a href="https://t.me/" rel="noopener">Telegram</a>
                <a href="https://instagram.com/" rel="noopener">Instagram</a>
              </div>
            </div>
            <div className="container muted small">© {new Date().getFullYear()} SHEN</div>
          </footer>
          <CartDrawer />
        </CartProvider>
        <Analytics />
      </body>
    </html>
  );
}
