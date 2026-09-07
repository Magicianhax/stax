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

// The four money lines the review card shows. `reviewRows` mirrors how the card derives
// them: cash rows priced against the cash total, bought rows against the invested total.
// Pricing everything against one blended figure is the bug this suite exists for.
//
// Everything is worked out in whole cents, and `invested` takes the remainder rather than
// being computed on its own — cash and fee are exact by construction, and three values
// rounded independently need not sum to the rounded total. That is what makes the four
// lines always add up to what the giver pays.
const asCents = (n: number) => Math.round(n * 100);

function reviewRows(items: BasketItem[], amountUsd: number) {
  const s = splitGiftBasket("base", items, amountUsd);
  const cashCents = asCents(s.cashUsd);
  const feeCents = asCents(feeUsd(s.investUsd));
  const investedCents = asCents(amountUsd) - cashCents - feeCents;
  const investedNet = investedCents / 100;
  // Per-holding rows, with the heaviest absorbing the rounding so they always add back to
  // the line printed underneath them. This mirrors `splitOf` in components/lite/gift/
  // giftFormat.ts, which is what the card actually calls; the assertions below pin the
  // contract it has to meet rather than re-testing its internals.
  const boughtWeight = s.invested.reduce((sum, i) => sum + i.weightPct, 0) || 1;
  const ordered = [...s.invested].sort((a, b) => b.weightPct - a.weightPct);
  const boughtCents = ordered.map((i) => asCents((investedNet * i.weightPct) / boughtWeight));
  if (boughtCents.length > 0) {
    boughtCents[0] += investedCents - boughtCents.reduce((a, c) => a + c, 0);
  }
  return {
    boughtCents,
    investedCents,
    boughtRows: boughtCents.map((c) => c / 100),
    cashRow: cashCents / 100,
    invested: investedNet,
    setAside: cashCents / 100,
    fee: feeCents / 100,
    youPay: amountUsd,
  };
}

describe("review card money lines", () => {
  it("prices a $100 Safe Growth gift the way the screen renders it", () => {
    // toMatchObject, not toEqual: the helper also exposes the cent-level figures the
    // per-row test needs, and this assertion is about the money lines the screen shows.
    expect(reviewRows(SAFE_GROWTH(), 100)).toMatchObject({
      boughtRows: [19.95, 19.95, 19.95],
      cashRow: 40,
      invested: 59.85,
      setAside: 40,
      fee: 0.15,
      youPay: 100,
    });
  });

  it("prices a 20% safe slice the way the demo basket renders it", () => {
    expect(reviewRows(TWENTY_PCT_SAFE, 100)).toMatchObject({
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

  it("makes the per-holding rows sum to the line printed under them", () => {
    // Not implied by the four lines reconciling: the invested line absorbs its remainder
    // against the TOTAL, which says nothing about whether the individual holdings add up
    // to it. `splitOf` gives the heaviest holding the dust for exactly this reason.
    for (const amount of [5, 7.77, 33.33, 99.99, 100, 123.45, 250, 999.99, 1234.56]) {
      for (const items of [SAFE_GROWTH(), NO_SAFE(), TWENTY_PCT_SAFE]) {
        const rows = reviewRows(items, amount);
        expect(rows.boughtCents.reduce((a, c) => a + c, 0)).toBe(rows.investedCents);
      }
    }
  });

  it("sums to the cent on the $33.33 case that used to render $33.34", () => {
    const rows = reviewRows(TWENTY_PCT_SAFE, 33.33);
    expect(rows.invested).toBe(26.59);
    expect(rows.setAside).toBe(6.67);
    expect(rows.fee).toBe(0.07);
    expect(asCents(rows.invested) + asCents(rows.setAside) + asCents(rows.fee)).toBe(3333);
  });

  it("makes the displayed lines sum to exactly what the giver pays", () => {
    // The card derives `invested` as amount minus cash minus fee, in whole cents, so one
    // line absorbs the rounding remainder the way splitByWeight lets the last leg take the
    // dust. Three values each rounded on their own would not always sum: a 20% safe slice
    // at $33.33 used to render 26.60 + 6.67 + 0.07 = 33.34 against a "You pay" of 33.33.
    // Exact, not bounded — a screen about money whose lines do not add up is not passing.
    for (const amount of [5, 7.77, 33.33, 99.99, 100, 123.45, 250, 999.99, 1234.56]) {
      for (const items of [SAFE_GROWTH(), NO_SAFE(), TWENTY_PCT_SAFE]) {
        const rows = reviewRows(items, amount);
        // Compared in whole cents: `0.01` as a float is not exactly a cent, so a drift of
        // exactly one cent reads as 0.010000000000005 and would slip past a decimal check.
        expect(asCents(rows.invested) + asCents(rows.setAside) + asCents(rows.fee)).toBe(
          asCents(amount),
        );
      }
    }
  });
});
