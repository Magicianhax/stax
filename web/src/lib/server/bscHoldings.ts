import "server-only";

// The BSC smart account's current per-asset holdings, tier-tagged and priced in USD, for the
// rule engine's holdings-based rules (rebalance, safety_switch, mix_keeper — see rulesEngine.ts's
// file header). Reads the exact same merged Wallet API + RPC balances /api/portfolio shows
// (lib/server/bscBalances.ts, factored out of that route so both read identically off one shared
// cache) and prices each position the same way the app already prices it everywhere else: a
// stock at its own issuer's live catalog `tokenPrice` (lib/server/rwaCatalog.ts — the same number
// the Venues panel and the buy_discount rule already trust), crypto at the same aggregator quote
// price TradeScreen shows (lib/prices.ts). A position this can't price — the catalog dropped the
// address, a crypto quote failed — is left out of the result entirely rather than reported at a
// guessed value: a rule that can't see its own risk shouldn't act on a partial picture.
//
// Both issuers of one stock are read and priced SEPARATELY (the default address's balance against
// its own venue's tokenPrice, the twin's balance against the TWIN's venue's tokenPrice — never one
// issuer's price borrowed for the other's balance), then folded into one TieredHolding per symbol:
// every evaluator in lib/rules.ts (evaluateRebalance, evaluateMixKeeper, evaluateSafetySwitch)
// reasons about a ticker's total weight, not which issuer minted it — the same way the risk and
// allocation math elsewhere on this chain already treats a ticker as one position regardless of
// venue.
import type { Asset, StaxChain } from "@/lib/chains/types";
import { fromUnits } from "@/lib/format";
import { priceAll } from "@/lib/prices";
import type { TieredHolding } from "@/lib/rules";
import { bscBalanceMap } from "./bscBalances";
import { serverClient } from "./chain";
import { bscCatalogSnapshot } from "./rwaCatalog";

function candidateAddresses(assets: Asset[]): `0x${string}`[] {
  const out: `0x${string}`[] = [];
  for (const a of assets) {
    if (a.address) out.push(a.address);
    if (a.twin) out.push(a.twin.address);
  }
  return out;
}

/**
 * `null` when the read itself failed outright (a Binance/RPC error, never a fabricated empty
 * portfolio) — the caller (autopilotPlan.ts) leaves `ctx.holdings` undefined for that, which
 * rulesEngine.ts already turns into its plain "waiting on your holdings" skip. An empty array is
 * a real, successful read of an account that holds nothing priced yet — a legitimate "nothing to
 * rebalance/keep" input, not a failure.
 */
export async function getBscHoldings(chain: StaxChain, address: `0x${string}`, nowMs: number): Promise<TieredHolding[] | null> {
  if (chain.key !== "bsc") return null;
  try {
    const stocks = chain.assets.stocks.filter((a) => a.address && a.decimals);
    const crypto = chain.assets.crypto.filter((a) => a.address && a.decimals);
    const readAddresses = [...candidateAddresses(stocks), ...crypto.map((a) => a.address!)];

    const client = serverClient(chain);
    const [balances, catalog, cryptoPrices] = await Promise.all([
      bscBalanceMap(chain, client, address, readAddresses),
      bscCatalogSnapshot(nowMs),
      priceAll(chain, client, crypto),
    ]);

    const priceByAddress = new Map<string, number>();
    for (const t of catalog.tickers) for (const v of t.venues) priceByAddress.set(v.address.toLowerCase(), v.tokenPrice);

    const usdBySymbol = new Map<string, number>();
    const tierBySymbol = new Map<string, TieredHolding["tier"]>();
    const addUsd = (asset: Asset, usd: number) => {
      usdBySymbol.set(asset.symbol, (usdBySymbol.get(asset.symbol) ?? 0) + usd);
      tierBySymbol.set(asset.symbol, asset.tier);
    };

    for (const asset of stocks) {
      const raw = balances.get(asset.address!.toLowerCase()) ?? BigInt(0);
      if (raw > BigInt(0)) {
        const price = priceByAddress.get(asset.address!.toLowerCase());
        if (price !== undefined) addUsd(asset, fromUnits(raw, asset.decimals!) * price);
        // else: held but unpriced right now — dropped, never guessed.
      }
      if (asset.twin) {
        const twinRaw = balances.get(asset.twin.address.toLowerCase()) ?? BigInt(0);
        if (twinRaw > BigInt(0)) {
          const twinPrice = priceByAddress.get(asset.twin.address.toLowerCase());
          if (twinPrice !== undefined) addUsd(asset, fromUnits(twinRaw, asset.twin.decimals) * twinPrice);
        }
      }
    }

    for (const asset of crypto) {
      const raw = balances.get(asset.address!.toLowerCase()) ?? BigInt(0);
      if (raw <= BigInt(0)) continue;
      const price = cryptoPrices[asset.symbol]?.priceUsd;
      if (price === undefined) continue; // unpriced — dropped, never guessed.
      addUsd(asset, fromUnits(raw, asset.decimals!) * price);
    }

    return [...usdBySymbol.entries()].map(([symbol, usdValue]) => ({ symbol, usdValue, tier: tierBySymbol.get(symbol)! }));
  } catch (err) {
    console.warn("[bscHoldings] holdings read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
