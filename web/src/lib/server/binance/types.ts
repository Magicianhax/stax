import "server-only";

// The Binance Web3 API as Stax consumes it: the parsed, typed shapes the client returns, not
// the raw wire JSON. Token amounts become bigint and prices become number at the client
// boundary, so nothing downstream parses strings. Every field here was checked against a live
// response in docs/BINANCE-WEB3.md; where that doc and this file disagree, the doc wins.
import type { RwaPlatform } from "@/lib/chains";
import type { RwaMarketStatus, RwaReasonCode } from "@/lib/rwa";

/**
 * Business failures arrive as HTTP 200 with `code != 0`, so a request is only a success when
 * the body says so. The message never carries credentials.
 */
export class BinanceWeb3Error extends Error {
  constructor(
    public code: number,
    msg: string,
    public httpStatus: number,
  ) {
    super(`Binance Web3 ${code}: ${msg}`);
    this.name = "BinanceWeb3Error";
  }
}

/** An unsigned EVM transaction, as the Transaction API simulates it. */
export type EvmTx = { from: `0x${string}`; to: `0x${string}`; value: string; data: `0x${string}` };

export interface RwaStatusInfo {
  openState: boolean;
  marketStatus: RwaMarketStatus | null;
  reasonCode: RwaReasonCode;
  reasonMsg: string | null;
  /** Epoch ms. Unreliable while the status is premarket (it can precede nextOpenTime). */
  nextOpenTime: number | null;
  nextCloseTime: number | null;
}

export interface RwaToken {
  binanceChainId: string;
  /** Lowercase, as the API returns it. */
  tokenContractAddress: `0x${string}`;
  platformId: RwaPlatform;
  /** 1 stock, 3 ETF (incl. leveraged/inverse), 2 pre-IPO per docs; null on a few rows. */
  assetType: 1 | 2 | 3 | null;
  tokenName: string;
  /** "<TICKER>on" for Ondo, "<TICKER>B" for bStock. */
  tokenSymbol: string;
  tokenLogoUrl: string;
  decimals: number;
  underlyingTicker: string;
  underlyingName: string;
  /** Tokens per share, e.g. 1.0008982 — a token is not always exactly one share. */
  tokenToShareRatio: number;
  statusInfo: RwaStatusInfo;
  tokenPrice: number;
  referencePrice: number;
  volume24H: number;
  marketCap: number;
}

export interface RwaPrice {
  tokenContractAddress: `0x${string}`;
  platformId: RwaPlatform;
  tokenPrice: number;
  referencePrice: number;
  /** Epoch ms. */
  tokenPriceUpdatedAt: number;
}

export interface RwaSearchResult {
  ticker: string;
  companyName: string;
  assets: {
    platformId: RwaPlatform;
    binanceChainId: string;
    tokenContractAddress: `0x${string}`;
    tokenSymbol: string;
    assetType: number | null;
  }[];
}

/** Parsed from the wire's [open, high, low, close, volume, tMs, trades] tuple. */
export type Candle = { open: number; high: number; low: number; close: number; volume: number; t: number; trades: number | null };

export interface QuoteParams {
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  /** Smallest units of `fromToken`. */
  amount: bigint;
  /**
   * Sent as `userWalletAddress` on every quote, because any pair that could route through Ondo
   * RFQ is refused without it. It is the account that will call the router: the user's smart
   * account on the direct path, the executor on the executor path.
   */
  taker: `0x${string}`;
  slippagePercent?: string;
}

export interface AggQuote {
  quoteId: string;
  vendorName: string;
  /** Only "SWAP" has been seen live. A contract cannot sign "RFQ", so callers reject it. */
  executionMode: "SWAP" | "RFQ";
  fromTokenAmount: bigint;
  toTokenAmount: bigint;
  priceImpactPercent: number;
  /** The ERC-20 spender. Always equal to the chain's Binance router; callers assert it. */
  approveTarget: `0x${string}`;
  raw: unknown;
}

export interface AggSwapBuild {
  executionMode: "SWAP" | "RFQ";
  tx: {
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    /** Wei; "0" for a token-to-token swap. */
    value: string;
    gas: string;
    gasPrice: string;
    minReceiveAmount: bigint;
  };
}

export interface SimulateResult {
  /** "SUCCESS" when the transaction would succeed; other values unverified. */
  status: string;
  /** "" on success; the revert reason otherwise. */
  failReason: string;
  balanceChanges: { contractAddress: string; tokenType: string; change: string; owner: string }[];
  allowanceChanges: { tokenAddress: string; owner: string; spender: string; preAmount: string; postAmount: string }[];
}

export interface TokenAsset {
  binanceChainId: string;
  tokenContractAddress: string;
  address: string;
  symbol: string;
  /** Human decimal. */
  balance: string;
  /** Integer, base units. */
  rawBalance: bigint;
  /** USD; null when the API has no price. */
  tokenPrice: number | null;
  /** A scam / risk flag, not an asset class. No balance endpoint flags RWAs. */
  isRiskToken: boolean;
}

export interface BinanceWeb3 {
  rwaTokens(o?: { platformId?: RwaPlatform }): Promise<RwaToken[]>;
  /** At most 100 addresses per call. */
  rwaPrices(addrs: `0x${string}`[]): Promise<RwaPrice[]>;
  rwaSearch(keyword: string): Promise<RwaSearchResult[]>;
  rwaProfile(addr: `0x${string}`): Promise<unknown>;
  candles(addr: `0x${string}`, bar: "5m" | "1h" | "4h" | "1d", limit: number): Promise<Candle[]>;
  quote(p: QuoteParams): Promise<AggQuote>;
  buildSwap(p: QuoteParams & { quoteId: string; slippagePercent: string }): Promise<AggSwapBuild>;
  simulate(tx: EvmTx): Promise<SimulateResult>;
  /** At most 20 tokens per call. */
  balances(address: `0x${string}`, tokens: `0x${string}`[]): Promise<TokenAsset[]>;
}
