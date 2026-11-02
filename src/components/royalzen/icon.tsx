type IconName =
  | "home" | "plus" | "consultation" | "products" | "material"
  | "knowledge" | "history" | "settings" | "admin" | "chevron"
  | "menu" | "close" | "upload" | "window" | "palette" | "spark"
  | "arrow" | "check" | "search" | "users" | "chart" | "building" | "voice";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.8 12 3l9 7.8" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  consultation: <><path d="M5 4h14v16H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  products: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" /><path d="M12 11v10" /></>,
  material: <><path d="M4 19 19 4" /><path d="M6 4h14v14" /><path d="M4 9h4M9 4v4M4 14h2M14 4v2" /></>,
  knowledge: <><path d="M4 5.5A4.5 4.5 0 0 1 8.5 1H12v18H8.5A4.5 4.5 0 0 0 4 23V5.5Z" /><path d="M20 5.5A4.5 4.5 0 0 0 15.5 1H12v18h3.5A4.5 4.5 0 0 1 20 23V5.5Z" /></>,
  history: <><path d="M4 5v5h5" /><path d="M5.2 9A8 8 0 1 1 4 14" /><path d="M12 7v5l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  admin: <><path d="M4 21V7l8-4 8 4v14" /><path d="M8 10h8M8 14h8M9 21v-3h6v3" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v5h16v-5" /></>,
  window: <><path d="M4 4h16v16H4z" /><path d="M12 4v16M4 12h16" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.3a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3A8.2 8.2 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r=".7" /><circle cx="10" cy="6.8" r=".7" /><circle cx="14" cy="6.8" r=".7" /></>,
  spark: <><path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20V7" /></>,
  building: <><path d="M4 21V5l8-3 8 3v16M8 8h2M14 8h2M8 12h2M14 12h2M9 21v-5h6v5" /></>,
  voice: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
};

export default function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6">
      {PATHS[name]}
    </svg>
  );
}
