// Seed list so every stream can test against real addresses. The RWA catalog task replaces
// it with the curated list: the tickers both issuers list, plus a few Ondo-only megacaps,
// each with its twin. Addresses and 18 decimals come from live Binance RWA Data calls
// (docs/BINANCE-WEB3.md §7).
import type { Asset } from "./types";

const stock = (a: Omit<Asset, "tier" | "via" | "decimals">): Asset => ({
  ...a,
  tier: "stock",
  via: "binance",
  decimals: 18,
});

export const BSC_STOCKS: Asset[] = [
  stock({ symbol: "NVDA", name: "Nvidia", address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", platform: "bstock", onchainSymbol: "NVDAB" }),
  stock({ symbol: "TSLA", name: "Tesla", address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", platform: "bstock", onchainSymbol: "TSLAB" }),
  stock({ symbol: "MSFT", name: "Microsoft", address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", platform: "bstock", onchainSymbol: "MSFTB" }),
  stock({ symbol: "META", name: "Meta", address: "0x7425889fe94f9d693e8daefe88bcced6acfef4c0", platform: "bstock", onchainSymbol: "METAB" }),
  stock({ symbol: "GOOGL", name: "Google", address: "0x3f53de71c126bdabae20f9cd64848d317f6c3238", platform: "bstock", onchainSymbol: "GOOGLB" }),
  stock({ symbol: "AAPL", name: "Apple", address: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4", platform: "ondo", onchainSymbol: "AAPLon" }),
];

export const BSC_ASSETS = { stocks: BSC_STOCKS, safe: [] as Asset[], crypto: [] as Asset[], all: BSC_STOCKS };
