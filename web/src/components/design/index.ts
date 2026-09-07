// Stax design system — shared, presentational components for the Soft theme.
// Import surface for the screen/feature layers.

// Icons + brand
export { Icon, type IconName, type IconProps } from "./Icon";
export {
  StaxMark,
  StaxWordmark,
  VeraOrb,
  AssetTile,
  LogoCluster,
  type LogoClusterProps,
  type StaxMarkProps,
  type StaxWordmarkProps,
  type VeraOrbProps,
  type AssetTileProps,
  type TileAsset,
} from "./Brand";

// Charts / data-viz
export {
  Sparkline,
  PriceChart,
  RangeChips,
  Bars,
  ProjectionChart,
  RiskMeter,
  Donut,
  CountUp,
  type SparklineProps,
  type PriceChartProps,
  type PricePoint,
  type RangeChipsProps,
  type BarsProps,
  type BarDatum,
  type ProjectionChartProps,
  type RiskMeterProps,
  type DonutProps,
  type DonutSegment,
  type CountUpProps,
} from "./Charts";

// Surfaces / layout primitives
export {
  BottomSheet,
  Crossfade,
  HoldingRow,
  Eyebrow,
  VerifiedBadge,
  Seal,
  Stat,
  SectionTitle,
  Confetti,
  type BottomSheetProps,
  type CrossfadeProps,
  type HoldingRowProps,
  type HoldingChange,
  type EyebrowProps,
  type VerifiedBadgeProps,
  type StatProps,
  type SectionTitleProps,
  type ConfettiProps,
} from "./Surfaces";

// Motion primitives
export { useDragDismiss } from "../../hooks/useDragDismiss";
export type {
  UseDragDismissOptions,
  UseDragDismissResult,
} from "../../hooks/useDragDismiss";

// Amount keypad (money entry: Trade / Send / Goal / Gift)
export {
  Keypad,
  AmountInput,
  handleAmountKeyDown,
  CLEAR_HOLD_MS,
  type KeypadProps,
  type AmountInputProps,
} from "./Keypad";

// Navigation
export { TabBar, type TabBarProps, type TabId } from "./TabBar";

// Network (Base · Mantle)
export { ChainMark, NetworkChip, NetworkSwitch, ChainLaunching, ChainLaunchingLine } from "./Network";

// US stock-market hours (open/closed pill + explainer)
export { MarketStatus, useMarketStatus, type MarketStatusProps } from "./MarketStatus";

// Toast
export {
  Toast,
  ToastProvider,
  useToast,
  type ToastData,
} from "./Toast";

// Device frame
export {
  IOSFrame,
  IOSStatusBar,
  type IOSFrameProps,
  type IOSStatusBarProps,
} from "./IOSFrame";
