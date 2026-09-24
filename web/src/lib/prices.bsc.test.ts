// BSC crypto (BTCB/ETH/BNB) has no RWA catalog row and no reference share price, so it can't be
// priced the way tokenized stocks are (rwa/tokens). This pins that it's priced instead from the
// same Binance aggregator quote a trade would actually get — never an invented number — mirroring
// how Base prices a no-pool asset from a live Kyber quote.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./server/binance", () => ({ getBinanceWeb3: vi.fn() }));

import { getBinanceWeb3 } from "./server/binance";
import { assetBySymbol, getChain } from "./chains";
import { priceAsset } from "./prices";
import type { PublicClient } from "viem";

const bsc = getChain("bsc");
const quoteSpy = vi.fn();

beforeEach(() => {
  quoteSpy.mockReset();
  vi.mocked(getBinanceWeb3).mockReturnValue({ quote: quoteSpy } as unknown as ReturnType<typeof getBinanceWeb3>);
});

// Never called for a crypto asset (no pool, no feed, not a B20 stock, not on Base) — a call
// would mean this test is silently depending on a live RPC.
const client = { readContract: vi.fn(), getCode: vi.fn() } as unknown as PublicClient;

describe("priceAsset: BSC crypto", () => {
  it("prices BTCB from a $100 Binance aggregator quote, never the RWA catalog", async () => {
    const btcb = assetBySymbol(bsc, "BTCB")!;
    // $100 buys ~0.001 BTCB at an $84k-ish price → toTokenAmount in 18dp raw units.
    quoteSpy.mockResolvedValue({ toTokenAmount: BigInt("1190476190476190") }); // ~0.00119048
    const price = await priceAsset(bsc, client, btcb);

    expect(price.source).toBe("binance");
    expect(price.priceUsd).toBeCloseTo(100 / 0.00119047619, 0);
    expect(price.marketPrice).toBeUndefined(); // no reference price for crypto
    expect(quoteSpy).toHaveBeenCalledWith(expect.objectContaining({ toToken: btcb.address, fromToken: bsc.usdc.address }));
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("is honest (undefined) rather than inventing a price when the aggregator has no route", async () => {
    const bnb = assetBySymbol(bsc, "BNB")!;
    quoteSpy.mockRejectedValue(new Error("no route"));
    const price = await priceAsset(bsc, client, bnb);
    expect(price.priceUsd).toBeUndefined();
    expect(price.source).toBe("none");
  });
});
