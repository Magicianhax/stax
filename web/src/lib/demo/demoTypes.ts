// Shapes shared by the demo worlds (Base's, in demoData.ts, and BNB Chain's, in bscWorld.ts) and
// the provider that serves them. Types only, so nothing here can pull in a component.
import type { Portfolio } from "@/hooks/useBalances";
import type { MarketHistoryResponse, MarketRange, MarketSummaryResponse } from "@/hooks/useMarket";
import type { PricesResponse } from "@/hooks/usePrices";
import type { SavingsRateResponse } from "@/app/api/savings/route";
import type { RwaPlatform } from "@/lib/chains";
import type { ChainKey } from "@/lib/chains/types";
import type { EarningsMap } from "@/lib/earnings";
import type { ActivityRow, VeraRecord } from "@/lib/onchainHistory";
import type { RwaListResponse } from "@/lib/rwa";
import type { SpreadBoardResponse, SpreadTickerHistoryResponse } from "@/lib/spread";
import type { WalletTx } from "@/lib/walletTx";
import type { DemoHistory } from "@/lib/demo/demoHistory";

export type { MarketHistoryResponse, MarketRange };

/** What the visitor did in this session: the demo keeps it in memory, never on a chain. */
export type DemoFill =
  | {
      kind: "trade";
      side: "buy" | "sell";
      symbol: string;
      /** BNB Chain: which issuer's token changed hands. Undefined means the asset's own default. */
      venue?: RwaPlatform;
      /** Dollars spent (buy) or received (sell). */
      usd: number;
      /** Units bought or sold. */
      qty: number;
      txHash: `0x${string}`;
    }
  | {
      kind: "save";
      /** Positive moves cash into Savings, negative moves it back out. */
      usd: number;
      txHash: `0x${string}`;
    };

/** Everything one demo network shows, as plain data. */
export interface DemoWorld {
  chain: ChainKey;
  address: `0x${string}`;
  usdc: { raw: bigint; value: number };
  portfolio: Portfolio;
  activity: ActivityRow[];
  transactions: WalletTx[];
  veraRecord: VeraRecord;
  prices: PricesResponse;
  marketSummary: MarketSummaryResponse;
  history: (range: MarketRange) => DemoHistory;
  /** BNB Chain only; null elsewhere. */
  rwa: RwaListResponse | null;
  spreadBoard: SpreadBoardResponse | null;
  spreadHistory: (ticker: string) => SpreadTickerHistoryResponse | null;
  earnings: EarningsMap | null;
  savings: { balanceUsd: number; rate: SavingsRateResponse } | null;
  /** The instant the demo's market is read at (see lib/demo/bscMarket.ts demoClock). */
  nowMs: number;
}
