"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
const UTM_KEY = "shen-utm";
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

export function track(event: string, data?: Record<string, unknown>, eventId?: string) {
  window.fbq?.("track", event, data, eventId ? { eventID: eventId } : undefined);
}

export function getUtm(): Record<string, string> | undefined {
  try {
    const saved = localStorage.getItem(UTM_KEY);
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();

  // Запамʼятовуємо UTM-мітки з реклами, щоб вони потрапили в замовлення в KeyCRM.
  useEffect(() => {
    const utm: Record<string, string> = {};
    for (const key of UTM_FIELDS) {
      const value = params.get(key);
      if (value) utm[key] = value.slice(0, 200);
    }
    if (Object.keys(utm).length) {
      try {
        localStorage.setItem(UTM_KEY, JSON.stringify(utm));
      } catch {}
    }
  }, [params]);

  useEffect(() => {
    window.fbq?.("track", "PageView");
  }, [pathname]);

  return null;
}

export function Analytics() {
  return (
    <>
      {PIXEL_ID && (
        <Script id="fb-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');`}
        </Script>
      )}
      <Suspense fallback={null}>
        <Tracker />
      </Suspense>
    </>
  );
}
