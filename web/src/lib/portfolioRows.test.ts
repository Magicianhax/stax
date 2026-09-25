// buildAssetRows turns one asset's on-chain balances into the /api/portfolio holding rows —
// the default address always, plus a second row for the twin's own balance when the user holds
// it (a bStock buyer who was later paid in Ondo's NVDAon, or vice versa). Base and Mantle assets
// never carry a `.twin`, so the twin branch is provably a no-op there — this file is what keeps
// that true without re-reading the whole route by eye.
import { describe, expect, it } from "vitest";
import type { Asset } from "./chains";
import { buildAssetRows } from "./portfolioRows";

// `2_000000000000000000n` needs an ES2020 target this repo doesn't build with (see
// decimals.regression.test.ts), and `BigInt(2_000000000000000000)` would round-trip the literal
// through a `number` first and silently lose precision past 2^53, so whole-token amounts are
// built the same safe way the app itself does — `BigInt(whole) * BigInt(10) ** BigInt(decimals)`.
const tokens18 = (whole: number): bigint => BigInt(whole) * BigInt(10) ** BigInt(18);

const nvda: Asset = {
  symbol: "NVDA",
  name: "Nvidia",
  tier: "stock",
  via: "binance",
  address: "0xdefault000000000000000000000000000000001",
  decimals: 18,
  platform: "bstock",
  twin: { platform: "ondo", address: "0xtwin0000000000000000000000000000000002", onchainSymbol: "NVDAon", decimals: 18 },
};

const noTwin: Asset = {
  symbol: "AAVEUSD",
  name: "Safe dollars",
  tier: "safe",
  via: "aave_v3",
  address: "0xasafe00000000000000000000000000000003",
  decimals: 6,
};

describe("buildAssetRows", () => {
  it("labels even the default row with its own venue, so two rows of one ticker are never ambiguous", () => {
    const rows = buildAssetRows({
      asset: nvda,
      defaultRaw: tokens18(2), // 2 tokens, 18dp
      defaultPriceUsd: 100,
      dayChangePct: 1.5,
      spark: [1, 2, 3],
      apy: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      symbol: "NVDA",
      raw: "2000000000000000000",
      qty: 2,
      priceUsd: 100,
      valueUsd: 200,
      venue: "bstock",
    });
  });

  it("leaves venue undefined for an asset with no platform (every Base/Mantle holding)", () => {
    const rows = buildAssetRows({ asset: noTwin, defaultRaw: BigInt(10) * BigInt(10) ** BigInt(6), defaultPriceUsd: 1, dayChangePct: null, spark: null, apy: null });
    expect(rows[0].venue).toBeUndefined();
  });

  it("emits two rows, each with its own venue, price and qty, when both venues are held", () => {
    const rows = buildAssetRows({
      asset: nvda,
      defaultRaw: tokens18(1), // 1 NVDAB
      defaultPriceUsd: 100,
      twinRaw: tokens18(3), // 3 NVDAon
      twinPriceUsd: 99,
      dayChangePct: 1.5,
      spark: [1, 2, 3],
      apy: null,
    });
    expect(rows).toHaveLength(2);
    const [byDefault, byTwin] = rows;
    expect(byDefault).toMatchObject({ symbol: "NVDA", venue: "bstock", qty: 1, priceUsd: 100, valueUsd: 100 });
    expect(byTwin).toMatchObject({ symbol: "NVDA", venue: "ondo", qty: 3, priceUsd: 99, valueUsd: 297 });
    // Same ticker, same real-world day move on both rows — there's one underlying share.
    expect(byDefault.dayChangePct).toBe(1.5);
    expect(byTwin.dayChangePct).toBe(1.5);
  });

  it("emits only the twin row when the default balance is zero", () => {
    const rows = buildAssetRows({
      asset: nvda,
      defaultRaw: BigInt(0),
      defaultPriceUsd: 100,
      twinRaw: tokens18(5),
      twinPriceUsd: 101,
      dayChangePct: null,
      spark: null,
      apy: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "NVDA", venue: "ondo", qty: 5, priceUsd: 101 });
  });

  it("prices the twin as null (never the default's price) when the twin quote is missing", () => {
    const rows = buildAssetRows({
      asset: nvda,
      defaultRaw: BigInt(0),
      defaultPriceUsd: 100,
      twinRaw: tokens18(1),
      twinPriceUsd: null,
      dayChangePct: null,
      spark: null,
      apy: null,
    });
    expect(rows[0].priceUsd).toBeNull();
    expect(rows[0].valueUsd).toBeNull();
  });

  it("never emits a twin row for an asset that has no twin (Base/Mantle assets, and BSC's Ondo-only tickers)", () => {
    const rows = buildAssetRows({
      asset: noTwin,
      defaultRaw: BigInt(10) * BigInt(10) ** BigInt(6),
      defaultPriceUsd: 1,
      // twinRaw would be meaningless here — the caller never has one to pass, but confirm the
      // function doesn't fabricate a row even if a stray value showed up.
      twinRaw: BigInt(999),
      twinPriceUsd: 1,
      dayChangePct: null,
      spark: null,
      apy: 4.2,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].apy).toBe(4.2);
  });

  it("emits nothing for a zero balance on both sides", () => {
    expect(buildAssetRows({ asset: nvda, defaultRaw: BigInt(0), defaultPriceUsd: 100, dayChangePct: null, spark: null, apy: null })).toEqual(
      [],
    );
  });
});
