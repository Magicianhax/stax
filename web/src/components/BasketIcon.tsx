// Leaf: basket tile glyphs as Lucide icons (the product's one icon family).
// Shared by the app's basket tiles and the marketing site, so it depends on
// nothing but lucide-react and the icon name union from lib/baskets.
import {
  Bitcoin,
  Building2,
  Coins,
  Cpu,
  Gem,
  Globe,
  Layers,
  Rocket,
  ShoppingBasket,
  Sparkles,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import type { BasketIcon } from "@/lib/baskets";

const ICONS: Record<BasketIcon, LucideIcon> = {
  basket: ShoppingBasket,
  building: Building2,
  cpu: Cpu,
  coins: Coins,
  sprout: Sprout,
  rocket: Rocket,
  bitcoin: Bitcoin,
  layers: Layers,
  globe: Globe,
  gem: Gem,
  sparkles: Sparkles,
};

export function BasketIconGlyph({ icon, size = 20, color, strokeWidth = 2 }: { icon: BasketIcon; size?: number; color?: string; strokeWidth?: number }) {
  const Cmp = ICONS[icon] ?? ShoppingBasket;
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} aria-hidden="true" />;
}
