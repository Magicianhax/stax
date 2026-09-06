// Token logos for the Receive flow. The tokens people can send in from other
// networks (USDT, native coins, …) are not market-list assets, so they are not
// in displayAssets' DISPLAY table (which drives that list). This is the small
// self-hosted map for them; anything unmapped falls back to TokenLogo's monogram.
const TOKEN_LOGO: Record<string, string> = {
  USDC: "/icons/usdc.svg",
  USDT: "/icons/tokens/usdt.svg",
  ETH: "/icons/tokens/eth.svg",
  WETH: "/icons/tokens/eth.svg",
  BNB: "/icons/tokens/bnb.svg",
  TRX: "/icons/tokens/trx.svg",
  BTC: "/icons/tokens/btc.svg",
  SOL: "/icons/tokens/sol.svg",
  AVAX: "/icons/tokens/avax.svg",
  POL: "/icons/tokens/matic.svg",
  MATIC: "/icons/tokens/matic.svg",
};

/** Self-hosted logo for a receivable token symbol, or undefined when we have none. */
export function tokenLogoFor(symbol: string): string | undefined {
  return TOKEN_LOGO[symbol.toUpperCase()];
}
