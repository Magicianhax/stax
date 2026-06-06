// Stax icon set — now backed by lucide-react for crisp, consistent, professional
// glyphs. The public API (name union + {name,size,stroke,style,className} props)
// is preserved so every call site keeps working via the same import.
//
// `stroke` maps to Lucide's strokeWidth. We also pass absoluteStrokeWidth so the
// visual stroke stays constant regardless of size — icons read uniformly whether
// rendered at 13px (badges) or 26px (the tab FAB).
import type { CSSProperties } from "react";
import {
  Home,
  Sparkles,
  LayoutGrid,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  ShieldCheck,
  Shield,
  Orbit,
  CreditCard,
  Landmark,
  Mail,
  Wallet,
  Settings,
  Bell,
  Link2,
  Info,
  X,
  ArrowLeft,
  Send,
  Lock,
  SlidersHorizontal,
  Receipt,
  Eye,
  Clock,
  TrendingUp,
  Sun,
  Moon,
  Vibrate,
  Signature,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type IconName =
  | "home"
  | "spark"
  | "grid"
  | "search"
  | "plus"
  | "arrowUR"
  | "arrowDR"
  | "chevR"
  | "chevL"
  | "chevD"
  | "check"
  | "shield"
  | "shieldPlain"
  | "orbit"
  | "card"
  | "bank"
  | "mail"
  | "wallet"
  | "settings"
  | "bell"
  | "link"
  | "info"
  | "close"
  | "back"
  | "send"
  | "lock"
  | "sliders"
  | "receipt"
  | "eye"
  | "clock"
  | "trend"
  | "sun"
  | "moon"
  | "vibrate"
  | "signature"
  | "globe";

export interface IconProps {
  name: IconName;
  size?: number;
  /** Stroke width — maps to Lucide strokeWidth (kept constant across sizes). */
  stroke?: number;
  style?: CSSProperties;
  className?: string;
}

// name → best-fit Lucide glyph. Chosen for semantic clarity + visual cohesion.
const MAP: Record<IconName, LucideIcon> = {
  home: Home,
  spark: Sparkles,
  grid: LayoutGrid,
  search: Search,
  plus: Plus,
  arrowUR: ArrowUpRight,
  arrowDR: ArrowDownRight,
  chevR: ChevronRight,
  chevL: ChevronLeft,
  chevD: ChevronDown,
  check: Check,
  shield: ShieldCheck,
  shieldPlain: Shield,
  orbit: Orbit,
  card: CreditCard,
  bank: Landmark,
  mail: Mail,
  wallet: Wallet,
  settings: Settings,
  bell: Bell,
  link: Link2,
  info: Info,
  close: X,
  back: ArrowLeft,
  send: Send,
  lock: Lock,
  sliders: SlidersHorizontal,
  receipt: Receipt,
  eye: Eye,
  clock: Clock,
  trend: TrendingUp,
  sun: Sun,
  moon: Moon,
  vibrate: Vibrate,
  signature: Signature,
  globe: Globe,
};

export function Icon({ name, size = 22, stroke = 1.8, style, className }: IconProps) {
  const Glyph = MAP[name];
  return (
    <Glyph
      size={size}
      strokeWidth={stroke}
      absoluteStrokeWidth
      className={className}
      // currentColor is Lucide's default; keep block display for crisp alignment.
      style={{ display: "block", ...style }}
      aria-hidden
    />
  );
}
