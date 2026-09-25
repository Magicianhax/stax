import "server-only";

// The Transaction API, prefix /api/v1/dex (docs/BINANCE-WEB3.md §5). Only `simulate` is wired
// up: Stax sends through ERC-4337 (Pimlico), so it never reaches `broadcast-transaction`, which
// takes an EOA-signed raw tx.
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { EvmTx, SimulateResult } from "./types";

const BINANCE_CHAIN_ID = "56";

const wireSimulateResult = z.object({
  status: z.string(),
  failReason: z.string(),
  balanceChanges: z.array(
    z.object({ contractAddress: z.string(), tokenType: z.string(), change: z.string(), owner: z.string() }),
  ),
  allowanceChanges: z.array(
    z.object({ tokenAddress: z.string(), owner: z.string(), spender: z.string(), preAmount: z.string(), postAmount: z.string() }),
  ),
});

export async function simulate(tx: EvmTx): Promise<SimulateResult> {
  const data = await web3Request<unknown>(
    "POST",
    "/api/v1/dex/pre-transaction/simulate",
    {},
    { binanceChainId: BINANCE_CHAIN_ID, evmTx: tx },
  );
  const parsed = wireSimulateResult.safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/pre-transaction/simulate", 200);
  }
  return parsed.data;
}
