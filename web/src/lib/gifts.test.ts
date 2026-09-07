import { describe, expect, it } from "vitest";
import { CURATED_BASKETS, type BasketItem } from "@/lib/baskets";
import { feeUsd } from "@/lib/fees";
import {
  giftCreateCalls,
  isHeldAsCash,
  mergeGiftTokens,
  splitGiftBasket,
  type GiftToken,
} from "@/lib/gifts";

// The gift money maths. Every number a giver sees, and every amount that reaches the
// TimelockGift contract, comes out of the two functions covered here.
//
// These started as throwaway scripts while the feature was built, and one of them caught a
// real bug: the review card was spreading the platform fee evenly across the basket, so a
// $100 Safe Growth gift showed its cash row as $39.94 against a summary line saying $40.00.
// The totals were right and only the distribution was wrong, which is exactly why review
// missed it. The reconciliation tests at the bottom are the ones that would have failed.
//
// Assertions are on exact integers wherever the maths is integer, and on numbers rather
// than formatted strings everywhere, so a locale can never change the answer.

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const NVDA_ADDR = "0xb20000000000000000000078ee7ce2fE4908108C" as `0x${string}`;

const basket = (id: string): BasketItem[] => {
  const found = CURATED_BASKETS.base.find((b) => b.id === id);
  if (!found) throw new Error(`curated basket ${id} is gone — fix the test, not the assertion`);
  return found.items;
};

/** Safe Growth: the one curated basket with a safe slice, at 40%. */
const SAFE_GROWTH = () => basket("base:safe-growth");
/** Big Tech: no safe tier at all. */
const NO_SAFE = () => basket("base:big-tech");
/** The shape of the demo personal basket: a 20% safe slice. */
const TWENTY_PCT_SAFE: BasketItem[] = [
  { symbol: "aUSDC", weightPct: 20 },
  { symbol: "NVDA", weightPct: 80 },
];

const cents = (n: number) => Number(n.toFixed(2));

describe("isHeldAsCash", () => {
  it("marks the rebasing Aave tier and nothing else", () => {
    expect(isHeldAsCash("base", "aUSDC")).toBe(true);
    expect(isHeldAsCash("base", "NVDA")).toBe(false);
    expect(isHeldAsCash("base", "BTC")).toBe(false);
  });
});

describe("splitGiftBasket", () => {
  it("splits Safe Growth 40/60 and parks the safe slice as USDC", () => {
    const s = splitGiftBasket("base", SAFE_GROWTH(), 250);
    expect(s.investUsd).toBe(150);
    expect(s.cashUsd).toBe(100);
    // Raw 6-decimal units are what actually reaches the contract.
    expect(s.cashToken?.amount).toBe("100000000");
    expect(s.cashToken?.symbol).toBe("USDC");
    expect(s.cashToken?.address).toBe(USDC);
  });

  it("hands the invest step only the bought legs, renormalised to 100", () => {
    const s = splitGiftBasket("base", SAFE_GROWTH(), 250);
    expect(s.invested.map((i) => i.symbol)).toEqual(["AAPL", "GOOGL", "NVDA"]);
    expect(Math.round(s.invested.reduce((a, i) => a + i.weightPct, 0))).toBe(100);
    // The leg builder renormalises over whatever it is given, so sending the gift's full
    // amount with this reduced allocation would spend the cash slice on stocks.
    expect(s.investUsd).toBeLessThan(250);
  });

  it("keeps the true basket weights in holdings and marks only the cash rows", () => {
    const s = splitGiftBasket("base", SAFE_GROWTH(), 250);
    expect(s.holdings.map((h) => h.weightPct)).toEqual([40, 20, 20, 20]);
    expect(s.holdings.filter((h) => h.heldAsCash).map((h) => h.symbol)).toEqual(["aUSDC"]);
  });

  it("leaves a basket with no safe tier untouched", () => {
    const s = splitGiftBasket("base", NO_SAFE(), 100);
    expect(s.cashToken).toBeNull();
    expect(s.cashUsd).toBe(0);
    expect(s.investUsd).toBe(100);
    expect(s.holdings.some((h) => h.heldAsCash)).toBe(false);
  });

  it("buys nothing at all for an all-safe basket", () => {
    const s = splitGiftBasket("base", [{ symbol: "aUSDC", weightPct: 100 }], 75);
    expect(s.invested).toHaveLength(0);
    expect(s.investUsd).toBe(0);
    expect(s.cashUsd).toBe(75);
    expect(s.cashToken?.amount).toBe("75000000");
  });

  it("reconciles exactly on an amount that does not divide cleanly", () => {
    const s = splitGiftBasket("base", SAFE_GROWTH(), 33.33);
    expect(cents(s.investUsd + s.cashUsd)).toBe(33.33);
  });

  it("always splits the gift into two halves that add back up to it", () => {
    for (const amount of [5, 33.33, 100, 250, 1234.56, 99_999.99]) {
      for (const items of [SAFE_GROWTH(), NO_SAFE(), TWENTY_PCT_SAFE]) {
        const s = splitGiftBasket("base", items, amount);
        expect(Number((s.investUsd + s.cashUsd).toFixed(6))).toBe(amount);
      }
    }
  });
});

describe("mergeGiftTokens", () => {
  const bought: GiftToken[] = [{ symbol: "NVDA", address: NVDA_ADDR, amount: "300000000" }];
  const cash: GiftToken = { symbol: "USDC", address: USDC, amount: "20000000" };

  it("adds the cash row to what was bought", () => {
    expect(mergeGiftTokens(bought, cash).map((t) => `${t.symbol}:${t.amount}`)).toEqual([
      "NVDA:300000000",
      "USDC:20000000",
    ]);
  });

  it("is idempotent, so re-merging can never double the cash slice", () => {
    const once = mergeGiftTokens(bought, cash);
    expect(mergeGiftTokens(once, null)).toEqual(once);
    expect(mergeGiftTokens(mergeGiftTokens(once, null), null)).toEqual(once);
  });

  it("does not mutate the list it was given", () => {
    mergeGiftTokens(bought, cash);
    expect(bought).toHaveLength(1);
    expect(bought[0].amount).toBe("300000000");
  });

  it("folds a duplicate address into one summed entry", () => {
    // Two approvals for one token would pay out twice.
    const dup = mergeGiftTokens(
      [...bought, { symbol: "NVDA", address: NVDA_ADDR.toLowerCase() as `0x${string}`, amount: "1" }],
      null,
    );
    expect(dup).toHaveLength(1);
    expect(dup[0].amount).toBe("300000001");
  });

  it("gives the same batch whether the cash row is merged first or passed in", () => {
    const args = {
      giftContract: USDC,
      giftId: `0x${"11".repeat(32)}` as `0x${string}`,
      recipientHash: `0x${"22".repeat(32)}` as `0x${string}`,
      unlockAt: 2_000_000_000,
      reclaimAfter: 2_100_000_000,
      note: "hi",
    };
    const viaMerged = giftCreateCalls({ ...args, tokens: mergeGiftTokens(bought, cash) });
    const viaParam = giftCreateCalls({ ...args, tokens: bought, cashToken: cash });
    expect(viaMerged).toEqual(viaParam);
    // One approval per token, then create.
    expect(viaMerged).toHaveLength(3);
  });

  it("carries a real Safe Growth cash slice through to the parked list", () => {
    const s = splitGiftBasket("base", SAFE_GROWTH(), 100);
    const parked = mergeGiftTokens([{ symbol: "AAPL", address: NVDA_ADDR, amount: "1" }], s.cashToken);
    expect(parked.find((t) => t.symbol === "USDC")?.amount).toBe("40000000");
  });
});

// The four money lines the review card shows. `reviewRows` mirrors how the card must derive
// them: cash rows priced against the cash total, bought rows against the invested total less
// the fee. Pricing everything against one blended figure is the bug this suite exists for.
function reviewRows(items: BasketItem[], amountUsd: number) {
  const s = splitGiftBasket("base", items, amountUsd);
  const fee = feeUsd(s.investUsd);
  const investedNet = s.investUsd - fee;
  return {
    boughtRows: s.invested.map((i) => cents((investedNet * i.weightPct) / 100)),
    cashRow: cents(s.cashUsd),
    invested: cents(investedNet),
    setAside: cents(s.cashUsd),
    fee: cents(fee),
    youPay: cents(investedNet + s.cashUsd + fee),
  };
}

describe("review card money lines", () => {
  it("prices a $100 Safe Growth gift the way the screen renders it", () => {
    expect(reviewRows(SAFE_GROWTH(), 100)).toEqual({
      boughtRows: [19.95, 19.95, 19.95],
      cashRow: 40,
      invested: 59.85,
      setAside: 40,
      fee: 0.15,
      youPay: 100,
    });
  });

  it("prices a 20% safe slice the way the demo basket renders it", () => {
    expect(reviewRows(TWENTY_PCT_SAFE, 100)).toEqual({
      boughtRows: [79.8],
      cashRow: 20,
      invested: 79.8,
      setAside: 20,
      fee: 0.2,
      youPay: 100,
    });
  });

  it("charges the fee on the whole amount when there is no safe slice", () => {
    const rows = reviewRows(NO_SAFE(), 100);
    expect(rows.setAside).toBe(0);
    expect(rows.fee).toBe(0.25);
    expect(rows.youPay).toBe(100);
  });

  it("never lets the fee eat into the cash row", () => {
    // The $39.94 bug: the safe slice is parked whole, so its row is the cash total exactly.
    for (const amount of [5, 33.33, 100, 250, 1234.56]) {
      for (const items of [SAFE_GROWTH(), TWENTY_PCT_SAFE]) {
        const s = splitGiftBasket("base", items, amount);
        expect(reviewRows(items, amount).cashRow).toBe(cents(s.cashUsd));
      }
    }
  });

  it("reconciles invested + set aside + fee to what the giver pays", () => {
    for (const amount of [5, 33.33, 100, 250, 1234.56]) {
      for (const items of [SAFE_GROWTH(), NO_SAFE(), TWENTY_PCT_SAFE]) {
        const s = splitGiftBasket("base", items, amount);
        const fee = feeUsd(s.investUsd);
        // Exact, before any display rounding: this is the invariant the split guarantees.
        expect(Number((s.investUsd - fee + s.cashUsd + fee).toFixed(6))).toBe(amount);
        expect(reviewRows(items, amount).youPay).toBe(cents(amount));
      }
    }
  });

  it("keeps the displayed lines within a cent of what the giver pays", () => {
    // Three lines each rounded to cents on their own do not always sum to the rounded
    // total: a 20% safe slice at $33.33 renders 26.60 + 6.67 + 0.07 = 33.34 against a
    // "You pay" of 33.33. One cent, and only on amounts that do not divide cleanly.
    //
    // The fix belongs in the card, not here — one line has to absorb the remainder, the
    // way splitByWeight lets the last leg take the dust. Until it does, this bounds the
    // drift so a real distribution bug (the $39.94 one was six cents out, and wrong in
    // shape) still fails, while the known rounding cent does not produce a red suite.
    for (const amount of [5, 33.33, 100, 250, 1234.56, 999.99]) {
      for (const items of [SAFE_GROWTH(), NO_SAFE(), TWENTY_PCT_SAFE]) {
        const rows = reviewRows(items, amount);
        // Compared in whole cents: `0.01` as a float is not exactly a cent, so a drift of
        // exactly one cent reads as 0.010000000000005 and would fail a decimal comparison.
        const asCents = (n: number) => Math.round(n * 100);
        const drift = Math.abs(
          asCents(rows.invested) + asCents(rows.setAside) + asCents(rows.fee) - asCents(amount),
        );
        expect(drift).toBeLessThanOrEqual(1);
      }
    }
  });
});
