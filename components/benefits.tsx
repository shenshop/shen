import { LeatherIcon, SwapIcon, TruckIcon, WalletIcon } from "./icons";

const items = [
  { icon: <LeatherIcon />, title: "Натуральна шкіра", text: "Тільки якісні матеріали" },
  { icon: <TruckIcon />, title: "Нова Пошта та Укрпошта", text: "Відправка 1-2 дні" },
  { icon: <WalletIcon />, title: "Оплата при отриманні", text: "Спершу приміряйте" },
  { icon: <SwapIcon />, title: "Обмін 14 днів", text: "Якщо не підійшов розмір" },
];

export function Benefits({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={compact ? "benefits benefits-compact" : "benefits"}>
      {items.map((b) => (
        <li key={b.title}>
          {b.icon}
          <div>
            <strong>{b.title}</strong>
            <span>{b.text}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
