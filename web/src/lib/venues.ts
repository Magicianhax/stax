// Which token address a BSC manual trade actually touches, given an optional issuer choice.
// bStock and Ondo mint the same ticker at different addresses (chains/bsc.assets.ts); a buy or
// sell must resolve to exactly one of them before any Binance call or balance read happens.
// Shared by /api/swap-quote (Review Focus #1's buyable gate and the $6 floor both need the
// RESOLVED address, not the asset's default one), the manual-trade hooks and the portfolio's
// twin-holding rows — one rule, so a stray "which address did we mean" bug can't diverge
// between a quote and what actually gets bought.
import type { Asset, RwaPlatform, StaxChain } from "./chains";

export interface VenueResolution {
  address: `0x${string}`;
  /** The resolved address's own issuer; undefined for a non-RWA asset (no platform at all). */
  platform: RwaPlatform | undefined;
}

/**
 * Resolves `venue` against `asset` on `chain`:
 *  - off BSC, or an asset with no `platform` (not a BSC tokenized stock) — `venue` is
 *    meaningless, so it's ignored and the asset's own address is returned.
 *  - no `venue`, or `venue` equals the asset's own platform — the asset's own address.
 *  - `venue` equals the twin's platform — the twin's address.
 *  - any other `venue` — the asset doesn't list that issuer; `null` (the caller's 400).
 *  - an asset with no address at all (never routable) — `null`.
 */
export function resolveVenueAddress(chain: StaxChain, asset: Asset, venue?: RwaPlatform): VenueResolution | null {
  if (!asset.address) return null;
  if (chain.key !== "bsc" || !asset.platform) {
    return { address: asset.address, platform: asset.platform };
  }
  if (!venue || venue === asset.platform) {
    return { address: asset.address, platform: asset.platform };
  }
  if (asset.twin && venue === asset.twin.platform) {
    return { address: asset.twin.address, platform: asset.twin.platform };
  }
  return null;
}

/**
 * Which venue a manual trade's HOLDING ROW must match, on `chain`. Off BSC there's only ever one
 * row per symbol (no `platform` at all), so any row matches and this returns undefined. On BSC,
 * an explicit `venue` wins; with none picked, it's the asset's own platform — never "whichever
 * row comes first" for the ticker, because the portfolio sorts twin rows by value, so the Ondo
 * twin can be first even when the trade itself (via resolveVenueAddress) means bStock. The
 * holding lookup, the "via bStock/Ondo" label and the resolved trade address all call this (or
 * resolveVenueAddress) so they can't disagree about which issuer a trade means.
 */
export function holdingVenue(chain: StaxChain, asset: Asset, venue?: RwaPlatform): RwaPlatform | undefined {
  if (chain.key !== "bsc") return undefined;
  return venue ?? asset.platform;
}
