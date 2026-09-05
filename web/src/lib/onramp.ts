// Coinbase Onramp / Offramp deep links ("Add money" / "Cash out" on Wallet).
//
// Env-gated on NEXT_PUBLIC_CDP_PROJECT_ID (the CDP project id, Coinbase's `appId`).
// Unset → `onrampEnabled()` is false and Wallet keeps the plain receive/QR flow.
// Base only: Coinbase Onramp does not deliver to Mantle, so `onrampSupported`
// is false there and Wallet explains + falls back to Receive.
//
// Parameter names follow the current CDP docs (read 2026-09-05):
//   https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/generating-onramp-url
//   https://docs.cdp.coinbase.com/onramp-&-offramp/offramp-apis/generating-offramp-url
// Documented there: sessionToken (required), defaultNetwork, defaultAsset,
// presetFiatAmount, presetCryptoAmount, fiatCurrency, partnerUserRef (≤50 chars),
// redirectUrl, defaultExperience (onramp), defaultCashoutMethod (offramp).
//
// INFRA FOLLOW-UP: the docs now make `sessionToken` the required init — it is
// minted server-side by the Session Token API with a CDP secret API key and
// carries the destination address + assets. Until that route exists we build the
// earlier project-id ("secure init off") form: `appId` + JSON `addresses` +
// JSON `assets`. Pass `sessionToken` once the server route is in place and the
// builders switch to it automatically (appId/addresses/assets are then omitted).
import type { StaxChain } from "@/lib/chains";

const ONRAMP_URL = "https://pay.coinbase.com/buy/select-asset";
const OFFRAMP_URL = "https://pay.coinbase.com/v3/sell/input";

/** Coinbase network slug for a Stax chain; undefined when Coinbase can't deliver there. */
export function coinbaseNetwork(chain: StaxChain): string | undefined {
  return chain.key === "base" ? "base" : undefined;
}

export const ONRAMP_PRESETS = [25, 50, 100] as const;

export function cdpProjectId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_CDP_PROJECT_ID?.trim();
  return id ? id : undefined;
}

/** Add money is wired up (project id present). */
export function onrampEnabled(): boolean {
  return Boolean(cdpProjectId());
}

/** Add money works on this chain (Coinbase delivers there). */
export function onrampSupported(chain: StaxChain): boolean {
  return Boolean(coinbaseNetwork(chain));
}

export interface RampParams {
  chain: StaxChain;
  /** The user's smart-account address (where USDC lands / leaves from). */
  address: `0x${string}`;
  /** Whole US dollars to pre-fill. */
  amountUsd?: number;
  /** Stable per-user id (Privy user id) so Coinbase support can match a session. */
  partnerUserRef?: string;
  /** Where Coinbase sends the user afterwards (defaults to the app when in a browser). */
  redirectUrl?: string;
  /** Server-minted session token (infra follow-up); replaces appId/addresses/assets. */
  sessionToken?: string;
}

function sharedParams(p: RampParams, base: URLSearchParams): URLSearchParams | undefined {
  const network = coinbaseNetwork(p.chain);
  if (!network) return undefined;
  if (p.sessionToken) {
    base.set("sessionToken", p.sessionToken);
  } else {
    const appId = cdpProjectId();
    if (!appId) return undefined;
    base.set("appId", appId);
    base.set("addresses", JSON.stringify({ [p.address]: [network] }));
    base.set("assets", JSON.stringify(["USDC"]));
  }
  base.set("defaultNetwork", network);
  base.set("defaultAsset", "USDC");
  base.set("fiatCurrency", "USD");
  if (p.amountUsd && Number.isFinite(p.amountUsd) && p.amountUsd > 0) {
    base.set("presetFiatAmount", String(Math.round(p.amountUsd)));
  }
  if (p.partnerUserRef) base.set("partnerUserRef", p.partnerUserRef.slice(0, 50));
  const redirect = p.redirectUrl ?? (typeof window !== "undefined" ? `${window.location.origin}/app` : undefined);
  if (redirect) base.set("redirectUrl", redirect);
  return base;
}

/** Coinbase Onramp URL (buy USDC → the user's account), or undefined when not available. */
export function onrampUrl(p: RampParams): string | undefined {
  const q = sharedParams(p, new URLSearchParams());
  if (!q) return undefined;
  q.set("defaultExperience", "buy");
  return `${ONRAMP_URL}?${q.toString()}`;
}

/** Coinbase Offramp URL (sell USDC from the user's account → bank/PayPal), or undefined. */
export function offrampUrl(p: RampParams): string | undefined {
  const q = sharedParams(p, new URLSearchParams());
  if (!q) return undefined;
  return `${OFFRAMP_URL}?${q.toString()}`;
}
