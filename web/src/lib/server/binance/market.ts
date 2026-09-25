import "server-only";

// The general Market API, prefix /api/v1/dex/market (docs/BINANCE-WEB3.md §3). Only `candles`
// is wired up here; the rest of the section is UNVERIFIED or requires params this effort
// never sends.
import { z } from "zod";
import { web3Request } from "./client";
import { BinanceWeb3Error } from "./types";
import type { Candle } from "./types";

const BINANCE_CHAIN_ID = "56";

/**
 * `[open, high, low, close, volume, timestampMs, tradeCount]`, and the timestamp sits at index 5
 * (not 0, unlike a Binance spot kline). Parsed by position, not by key.
 *
 * docs/BINANCE-WEB3.md §3 says every value is a string, but a LIVE call (2026-09-24) returned
 * plain JSON numbers instead — the doc was wrong, or the wire format changed since it was
 * written. `wireNum` accepts either (and rejects null), so the parser survives whichever one Binance
 * actually sends on a given day. The trade count is the exception: LIVE rows older than a few days
 * send it as null (11 of 100 hourly rows on 2026-09-24), so it stays null rather than failing the
 * whole chart — a missing count isn't a price.
 */
// Not z.coerce.number(): that turns null into 0, and a zero-price candle is fabricated data.
const wireNum = z.union([z.number(), z.string()]).pipe(z.coerce.number().refine(Number.isFinite, "not a finite number"));
const wireCandleRow = z.tuple([wireNum, wireNum, wireNum, wireNum, wireNum, wireNum, wireNum.nullable()]);

export async function candles(addr: `0x${string}`, bar: "5m" | "1h" | "4h" | "1d", limit: number): Promise<Candle[]> {
  const data = await web3Request<unknown>("GET", "/api/v1/dex/market/candles", {
    binanceChainId: BINANCE_CHAIN_ID,
    tokenContractAddress: addr,
    bar,
    limit,
  });
  const parsed = z.array(wireCandleRow).safeParse(data);
  if (!parsed.success) {
    throw new BinanceWeb3Error(-1, "unexpected response shape: /api/v1/dex/market/candles", 200);
  }
  return parsed.data.map(([open, high, low, close, volume, t, trades]) => ({
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    t: Number(t),
    trades: trades === null ? null : Number(trades),
  }));
}
