type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const BagIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const CloseIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const MenuIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const TruckIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
);
export const SwapIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
);
export const LeatherIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M12 3c4 2 7 2 8 2 0 9-3 14-8 16C7 19 4 14 4 5c1 0 4 0 8-2Z" /></svg>
);
export const WalletIcon = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 15h2" /></svg>
);
export const PhoneIcon = ({ size = 20 }: P) => (
  <svg {...base(size)}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
);
export const MinusIcon = ({ size = 16 }: P) => <svg {...base(size)}><path d="M5 12h14" /></svg>;
export const PlusIcon = ({ size = 16 }: P) => <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>;
