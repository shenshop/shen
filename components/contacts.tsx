import { settings } from "@/data/settings";

export function formatPhone(phone: string) {
  return phone.replace(/^\+38(\d{3})(\d{3})(\d{2})(\d{2})$/, "+38 $1 $2 $3 $4");
}

/** Усі заповнені контакти з data/settings.ts. Порожні поля не показуються. */
export function contactLinks() {
  const s = settings;
  const digits = (n: string) => n.replace(/\D/g, "");
  return [
    s.instagram && { label: "Instagram", href: s.instagram },
    s.tiktok && { label: "TikTok", href: s.tiktok },
    s.facebook && { label: "Facebook", href: s.facebook },
    s.viber && { label: "Viber", href: `viber://chat?number=%2B${digits(s.viber)}` },
    s.telegram && { label: "Telegram", href: s.telegram.startsWith("+") ? `https://t.me/+${digits(s.telegram)}` : `https://t.me/${s.telegram.replace(/^@/, "")}` },
    s.whatsapp && { label: "WhatsApp", href: `https://wa.me/${digits(s.whatsapp)}` },
    s.email && { label: s.email, href: `mailto:${s.email}` },
  ].filter((l): l is { label: string; href: string } => Boolean(l));
}

export function Contacts() {
  return (
    <div className="contacts">
      {settings.phone && (
        <a href={`tel:${settings.phone}`} className="contacts-phone">
          {formatPhone(settings.phone)}
          {settings.workHours && <span className="muted small">{settings.workHours}</span>}
        </a>
      )}
      <div className="contacts-links">
        {contactLinks().map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener">
            {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}
