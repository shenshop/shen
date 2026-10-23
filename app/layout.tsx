import { SITE_URL } from "@/lib/seo";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart";
import { Header } from "@/components/header";
import { CartDrawer } from "@/components/cart-drawer";
import { Analytics, PixelScript } from "@/components/analytics";
import { getCatalog } from "@/lib/catalog";
import { Contacts, contactLinks } from "@/components/contacts";
import { ChatButton } from "@/components/chat-button";
import { settings } from "@/data/settings";

const font = Manrope({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "SHEN — взуття з натуральної шкіри", template: "%s — SHEN" },
  description: "Жіноче та чоловіче взуття з натуральної шкіри. Доставка Новою Поштою та Укрпоштою, оплата при отриманні, обмін 14 днів.",
  openGraph: { type: "website", locale: "uk_UA", siteName: settings.shopName },
};

export const viewport: Viewport = { themeColor: "#faf8f5", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { categories } = await getCatalog();
  return (
    <html lang="uk" className={font.variable}>
      <body>
        <PixelScript />
        <CartProvider>
          <Header categories={categories} shopName={settings.shopName} contacts={<Contacts />} />
          <main>{children}</main>
          <footer className="footer" id="kontakty">
            <div className="container footer-inner">
              <div>
                <p className="logo">{settings.shopName}</p>
                <p className="muted">Взуття з натуральної шкіри</p>
              </div>
              <Contacts />
            </div>
            <div className="container muted small">© {new Date().getFullYear()} {settings.shopName}</div>
          </footer>
          <CartDrawer />
          <ChatButton links={contactLinks().filter((l) => ["Viber", "Telegram", "WhatsApp"].includes(l.label))} />
        </CartProvider>
        <Analytics />
      </body>
    </html>
  );
}
