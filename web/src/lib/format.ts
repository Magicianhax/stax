// Small, jargon-free formatting helpers for the Stax UI.
// Copy rule: we say "free" not "gas", "account" not "wallet".
import { explorerAddress, explorerTx, type StaxChain } from "@/lib/chains";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** $1,234.56 — for precise dollar amounts. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return USD.format(n);
}

/** $1,234 — for round-number CTAs/headlines. */
export function usdWhole(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return USD_WHOLE.format(n);
}

/** 12.5% */
export function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Number(n.toFixed(2))}%`;
}

/** Convert a raw token amount (bigint) at `decimals` to a JS number (display only). */
export function fromUnits(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw);
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals);
  return Number(`${whole}.${frac}`);
}

/** Drop the zeroes a fixed number of places leaves behind: "0.01500" reads worse than "0.015". */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * A token quantity, at four significant figures and never in exponent notation.
 *
 * Exponents have no place in a broker. A third of a ten dollar gift in Bitcoin
 * printed as "3.14e-5 BTC", which nobody can read, compare, or check against a
 * receipt. Small quantities are exactly where fractional shares live, so they are
 * given the decimal places they need instead of being folded away.
 */
export function tokenQty(raw: bigint, decimals: number): string {
  const n = fromUnits(raw, decimals);
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return trimZeros(n.toFixed(3));
  // Below one, count places from the first significant digit. Capped, so a dust
  // balance is a short number rather than a wall of zeroes.
  const places = Math.min(12, 3 - Math.floor(Math.log10(n)));
  return trimZeros(n.toFixed(places));
}

/** "just now" / "4m ago" / "2h ago" / "3d ago" — age of a unix-seconds timestamp. */
export function timeAgo(unixSec: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unixSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

/** 0xabc…1234 — shortened address for trust signals. */
export function shortAddress(addr?: string): string {
  if (!addr || addr.length < 10) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Map a 0-10000 bps risk score to a friendly label + 0-100 meter value.
 * Lower = steadier, higher = bolder.
 */
export function riskLabel(bps: number): { label: string; value: number; tone: "success" | "warning" | "danger" | "accent" } {
  const value = Math.max(0, Math.min(100, Math.round(bps / 100)));
  if (value < 25) return { label: "Steady", value, tone: "success" };
  if (value < 50) return { label: "Balanced", value, tone: "accent" };
  if (value < 75) return { label: "Bold", value, tone: "warning" };
  return { label: "Spicy", value, tone: "danger" };
}

/** Block-explorer tx link on `chain` (Basescan / Mantlescan). */
export function txUrl(hash: string, chain: StaxChain): string {
  return explorerTx(chain, hash);
}

/** Block-explorer address/token link on `chain`. */
export function addressUrl(addr: string, chain: StaxChain): string {
  return explorerAddress(chain, addr);
}
