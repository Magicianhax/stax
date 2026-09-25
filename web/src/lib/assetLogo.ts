// assetLogo — the one place a screen asks "which logo for this symbol, on this chain, from this
// issuer". BSC's tokenized stocks have two branded logos per ticker (bStock's own mint and
// Ondo's own mint — lib/chains/bsc.logos.ts, sourced from Binance's RWA token list); everywhere
// else (Base, Mantle, crypto, cash) there's exactly one logo per symbol, unaffected by chain or
// venue, so this is exactly displayFor(symbol).logo there — unchanged from before this existed.
import { assetBySymbol, type RwaPlatform, type StaxChain } from "./chains";
import { displayFor } from "./displayAssets";
import { resolveVenueAddress } from "./venues";

/**
 * The logo to render for `symbol` on `chain`, from `venue`'s issuer when given.
 *  - Off BSC, or a BSC asset with no `platform` (crypto, cash — not an RWA token with an issuer
 *    choice): `venue` is meaningless and ignored, same as before this file existed.
 *  - No `venue`, or `venue` equal to the asset's own platform: the asset's own logo.
 *  - `venue` equal to the twin's platform: the twin's own logo.
 *  - Anything unresolved (unknown symbol, invalid venue, a logo missing from the generated data):
 *    falls back to `displayFor(symbol).logo`.
 */
export function assetLogo(chain: StaxChain, symbol: string, venue?: RwaPlatform): string | undefined {
  const asset = assetBySymbol(chain, symbol);
  if (chain.key === "bsc" && asset?.platform) {
    // Only an explicit, valid twin venue moves off the asset's own logo. Anything else — no
    // venue, the asset's own platform, or a venue this ticker doesn't actually list (AMZN has no
    // bStock twin) — stays on the asset's own real logo rather than falling through to a
    // different, unrelated fallback image.
    const resolved = resolveVenueAddress(chain, asset, venue);
    if (resolved?.platform === asset.twin?.platform && asset.twin?.logo) return asset.twin.logo;
    if (asset.logo) return asset.logo;
  }
  return displayFor(symbol, asset?.name).logo;
}
