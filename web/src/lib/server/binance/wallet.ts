import "server-only";

// The Wallet API, prefix /api/v1/dex (docs/BINANCE-WEB3.md §6). The POST body's nested shape
// (`tokenContractAddresses: [{ binanceChainId, tokenContractAddress }]`) is the one that works;
// research tried three flatter shapes first and every one failed with the generic 40001.
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { TokenAsset } from "./types";

const BINANCE_CHAIN_ID = "56";

const wireTokenAsset = z.object({
  binanceChainId: z.string(),
  tokenContractAddress: z.string(),
  address: z.string(),
  symbol: z.string(),
  balance: z.string(),
  rawBalance: z.string(),
  tokenPrice: z.string(),
  isRiskToken: z.boolean(),
});

const wireBalancesResponse = z.array(z.object({ tokenAssets: z.array(wireTokenAsset) }));

/** At most 20 tokens per call (docs/BINANCE-WEB3.md §6); refused before Binance sees it. */
export async function balances(address: `0x${string}`, tokens: `0x${string}`[]): Promise<TokenAsset[]> {
  if (tokens.length > 20) throw new Error(`balances: at most 20 tokens per call, got ${tokens.length}`);
  const data = await web3Request<unknown>(
    "POST",
    "/api/v1/dex/balance/token-balances-by-address",
    {},
    { address, tokenContractAddresses: tokens.map((t) => ({ binanceChainId: BINANCE_CHAIN_ID, tokenContractAddress: t })) },
  );
  const parsed = wireBalancesResponse.safeParse(data);
  if (!parsed.success || parsed.data.length === 0) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/balance/token-balances-by-address", 200);
  }
  return parsed.data[0].tokenAssets.map((a) => ({
    binanceChainId: a.binanceChainId,
    tokenContractAddress: a.tokenContractAddress,
    address: a.address,
    symbol: a.symbol,
    balance: a.balance,
    rawBalance: BigInt(a.rawBalance),
    tokenPrice: a.tokenPrice === "" ? null : Number(a.tokenPrice),
    isRiskToken: a.isRiskToken,
  }));
}
