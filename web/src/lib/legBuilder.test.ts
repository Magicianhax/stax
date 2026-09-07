import { describe, expect, it } from "vitest";
import { splitByWeight } from "@/lib/legBuilder";
import type { Asset } from "@/lib/chains/types";

// `splitByWeight` divides the USDC a user is spending across the legs of their allocation.
// It is on the ordinary invest path, which every user hits and gifting does not, and until
// now it had no coverage at all.
//
// Two properties matter more than the rest. It must lose and invent nothing: the legs have
// to add back to the amount handed in, to the micro-dollar. And it RENORMALISES over the
// entries it is given rather than trusting them to sum to 100 — convenient when a leg is
// dropped for having no route, and a trap for any caller who removes an entry without
// reducing the amount to match. That second behaviour is pinned below rather than assumed,
// because it is what would have quietly spent a gift's safe slice on stocks.
//
// Amounts are raw 6-decimal USDC as bigints, which is what the function actually takes.

const asset = (symbol: string): Asset => ({ symbol, name: symbol, tier: "stock", via: "kyber", decimals: 8 });

/** Entries from a list of weights, named A0, A1, … in order. */
const entries = (weights: number[]) => weights.map((weightPct, i) => ({ asset: asset(`A${i}`), weightPct }));

/** Dollars to raw 6-decimal USDC. */
const usdc = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));

const sum = (legs: { usdcIn: bigint }[]) => legs.reduce((total, l) => total + l.usdcIn, BigInt(0));

describe("splitByWeight", () => {
  it("splits an even basket evenly", () => {
    const legs = splitByWeight(entries([25, 25, 25, 25]), usdc(100));
    expect(legs.map((l) => l.usdcIn)).toEqual([usdc(25), usdc(25), usdc(25), usdc(25)]);
    expect(legs.map((l) => l.asset.symbol)).toEqual(["A0", "A1", "A2", "A3"]);
  });

  it("loses and invents nothing, whatever the shape or the amount", () => {
    const shapes = [
      [25, 25, 25, 25],
      [30, 25, 25, 20], // Big Tech
      [33.34, 33.33, 33.33],
      [99.99, 0.01],
      [50, 50, 0.0001],
      Array(12).fill(100 / 12), // BASKET_MAX_ITEMS
      [100],
    ];
    for (const shape of shapes) {
      for (const dollars of [0.07, 5, 7.77, 33.33, 100, 1234.56, 99_999.99]) {
        const total = usdc(dollars);
        expect(sum(splitByWeight(entries(shape), total))).toBe(total);
      }
    }
  });

  it("gives the last leg the rounding dust rather than dropping it", () => {
    // Thirds do not divide into 100 dollars. Each leg takes its share of what is still
    // unallocated, so the dust is a single micro-dollar on the last leg rather than a
    // visible skew, and nothing is left behind.
    const legs = splitByWeight(entries([33.33, 33.33, 33.33]), usdc(100));
    expect(legs.map((l) => l.usdcIn)).toEqual([
      BigInt(33_333_333),
      BigInt(33_333_333),
      BigInt(33_333_334),
    ]);
    expect(sum(legs)).toBe(usdc(100));
  });

  it("normalises over the entries it is given, not over 100", () => {
    // Weights summing to 60 still deploy the whole amount: each 20 becomes a third.
    // Not exactly a third, though — see the basis-point test below.
    const legs = splitByWeight(entries([20, 20, 20]), usdc(90));
    expect(sum(legs)).toBe(usdc(90));
    for (const leg of legs) {
      expect(Number(leg.usdcIn) / 1_000_000).toBeCloseTo(30, 1);
    }
  });

  it("keeps every leg within a hair of its true share", () => {
    // The property that replaced the old basis-point rounding. Weights used to be squeezed
    // into whole basis points, which cannot express a third: a 12-holding basket at $10,000
    // gave eleven legs $833.00 and the last $837.00, a $3.67 skew that grew with the amount
    // ($366 at $1,000,000). Allocating against the unallocated remainder removes it.
    const twelve = splitByWeight(entries(Array(12).fill(100 / 12)), usdc(10_000));
    for (const leg of twelve) {
      expect(Number(leg.usdcIn)).toBeGreaterThanOrEqual(833_333_333);
      expect(Number(leg.usdcIn)).toBeLessThanOrEqual(833_333_334);
    }
    expect(sum(twelve)).toBe(usdc(10_000));

    // Generally: no leg is off its ideal share by more than one micro-USDC per leg, which
    // is the most the sub-unit flooring can accumulate. At twelve legs that is twelve
    // millionths of a dollar. Measured across every shape and amount below, the worst seen
    // is 2.9 micro-USDC, on an eight-leg basket at a million dollars.
    const shapes = [
      [20, 20, 20],
      [25, 25, 25, 25],
      [30, 25, 25, 20],
      [33.33, 33.33, 33.33],
      Array(12).fill(100 / 12),
      [1, 2, 3, 5, 8, 13, 21, 34],
      [99.99, 0.01],
      [50, 50, 0.0001],
    ];
    for (const shape of shapes) {
      const totalWeight = shape.reduce((t, w) => t + w, 0);
      for (const dollars of [0.07, 5, 33.33, 100, 1234.56, 99_999.99, 1_000_000]) {
        const total = usdc(dollars);
        const legs = splitByWeight(entries(shape), total);
        expect(sum(legs)).toBe(total);
        for (const leg of legs) {
          const i = Number(leg.asset.symbol.slice(1));
          const ideal = (Number(total) * shape[i]) / totalWeight;
          expect(Math.abs(Number(leg.usdcIn) - ideal)).toBeLessThanOrEqual(shape.length);
        }
      }
    }
  });

  it("over-deploys a reduced weight set if the amount is not reduced with it", () => {
    // THE TRAP. Safe Growth is 40% safe dollars and 20% each of three stocks. Take the
    // safe slice out of the allocation but leave the amount at the full $100, and the
    // three survivors do not get $20 each — they get $33.33 each, silently spending the
    // safe slice's money on stocks. This is why POST /api/gifts returns `investUsd`
    // separately, and why the gift flow must send that rather than the gift's amount.
    const full = splitByWeight(entries([40, 20, 20, 20]), usdc(100));
    expect(full.map((l) => l.usdcIn)).toEqual([usdc(40), usdc(20), usdc(20), usdc(20)]);

    const reducedWeightsFullAmount = splitByWeight(entries([20, 20, 20]), usdc(100));
    expect(reducedWeightsFullAmount[0].usdcIn).toBe(BigInt(33_333_333));
    expect(sum(reducedWeightsFullAmount)).toBe(usdc(100)); // all of it, not 60% of it

    // Reducing the amount alongside the weights is what actually buys 20% each.
    const reducedBoth = splitByWeight(entries([20, 20, 20]), usdc(60));
    expect(reducedBoth.map((l) => l.usdcIn)).toEqual([usdc(20), usdc(20), usdc(20)]);
  });

  it("gives a single leg the whole amount", () => {
    const legs = splitByWeight(entries([100]), usdc(33.33));
    expect(legs).toHaveLength(1);
    expect(legs[0].usdcIn).toBe(usdc(33.33));

    // The weight is irrelevant when it is the only one — it is normalised against itself.
    expect(splitByWeight(entries([7]), usdc(50))[0].usdcIn).toBe(usdc(50));
  });

  it("returns nothing it cannot split", () => {
    expect(splitByWeight([], usdc(100))).toEqual([]);
    expect(splitByWeight(entries([0, 0]), usdc(100))).toEqual([]);
    // A zero amount yields a zero last leg, which is filtered out rather than sent.
    expect(splitByWeight(entries([50, 50]), BigInt(0))).toEqual([]);
  });

  it("drops legs too small to be worth a swap instead of sending zero-value ones", () => {
    // Three micro-dollars across four equal weights. The first floors to zero and is
    // dropped; the rest each take a share of what is left, so the three micro-dollars
    // spread across three legs instead of landing on one. Every returned leg is
    // spendable and the total is exact. Far below the $5 minimum, but the maths holds.
    const legs = splitByWeight(entries([25, 25, 25, 25]), BigInt(3));
    expect(legs.map((l) => l.asset.symbol)).toEqual(["A1", "A2", "A3"]);
    expect(legs.map((l) => l.usdcIn)).toEqual([BigInt(1), BigInt(1), BigInt(1)]);
    expect(legs.every((l) => l.usdcIn > BigInt(0))).toBe(true);
  });

  it("never returns a leg with nothing in it", () => {
    for (const shape of [[25, 25, 25, 25], [99.99, 0.01], [50, 50, 0.0001]]) {
      for (const raw of [0, 1, 3, 7, 999, 70_000]) {
        const legs = splitByWeight(entries(shape), BigInt(raw));
        expect(legs.every((l) => l.usdcIn > BigInt(0))).toBe(true);
        expect(sum(legs)).toBe(BigInt(raw));
      }
    }
  });

  it("handles the awkward amounts exactly", () => {
    // $33.33 and 7 cents, the two the money screens round badly.
    expect(sum(splitByWeight(entries([40, 20, 20, 20]), usdc(33.33)))).toBe(usdc(33.33));
    const cents = splitByWeight(entries([40, 20, 20, 20]), usdc(0.07));
    expect(sum(cents)).toBe(usdc(0.07));
    expect(cents.every((l) => l.usdcIn > BigInt(0))).toBe(true);
  });
});
