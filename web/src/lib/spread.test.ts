// The spread engine's pure rules: when a token's price counts as a premium (weekend/after-hours)
// or a discount worth acting on, the price difference between bStock and Ondo for one ticker,
// the ranked issuer board, the plain sentence a row reads as, and which issuer is cheaper right
// now. No network, no Redis — every input here is exactly what lib/rwa.ts's VenueView already
// carries, so this stays a thin, fully-tested layer on top of it.
import { describe, expect, it } from "vitest";
import {
  DISCOUNT_THRESHOLD_PCT,
  PREMIUM_THRESHOLD_PCT,
  cheaperIssuerNow,
  classifySpread,
  issuerDiffSentence,
  issuerDifference,
  isMarketClosedState,
  isOutsideRegularHours,
  platformLabel,
  rankIssuerBoard,
} from "./spread";

describe("isMarketClosedState", () => {
  it("is true for closed, overnight, paused and unsupported", () => {
    expect(isMarketClosedState("closed")).toBe(true);
    expect(isMarketClosedState("overnight")).toBe(true);
    expect(isMarketClosedState("paused")).toBe(true);
    expect(isMarketClosedState("unsupported")).toBe(true);
  });

  it("is false while the market is actually trading, even pre/post market", () => {
    expect(isMarketClosedState("open")).toBe(false);
    expect(isMarketClosedState("premarket")).toBe(false);
    expect(isMarketClosedState("postmarket")).toBe(false);
  });
});

describe("isOutsideRegularHours", () => {
  it("is true for every closed state plus pre/post market — the reference price is stale in all of them", () => {
    expect(isOutsideRegularHours("closed")).toBe(true);
    expect(isOutsideRegularHours("overnight")).toBe(true);
    expect(isOutsideRegularHours("paused")).toBe(true);
    expect(isOutsideRegularHours("unsupported")).toBe(true);
    expect(isOutsideRegularHours("premarket")).toBe(true);
    expect(isOutsideRegularHours("postmarket")).toBe(true);
  });

  it("is false only while the regular session is open", () => {
    expect(isOutsideRegularHours("open")).toBe(false);
  });
});

describe("classifySpread", () => {
  it("flags a premium only once the market is shut AND the gap clears the threshold", () => {
    const shutAndUp = classifySpread({ gapPct: PREMIUM_THRESHOLD_PCT + 2, buyable: true, state: "closed" });
    expect(shutAndUp.label).toBe("premium");
    expect(shutAndUp.sentence).toMatch(/more than the real share/i);
    expect(shutAndUp.sentence).not.toMatch(/spread|gap|venue|bps/i);

    // Open market with the same gap is not a weekend premium — the reference price is live.
    const openAndUp = classifySpread({ gapPct: PREMIUM_THRESHOLD_PCT + 2, buyable: true, state: "open" });
    expect(openAndUp.label).not.toBe("premium");

    // Shut but under the threshold isn't flagged either.
    const shutButSmall = classifySpread({ gapPct: PREMIUM_THRESHOLD_PCT - 0.1, buyable: true, state: "closed" });
    expect(shutButSmall.label).not.toBe("premium");
  });

  it("flags a premium after-hours too — postmarket and premarket are outside the regular session", () => {
    const postmarket = classifySpread({ gapPct: PREMIUM_THRESHOLD_PCT + 2, buyable: true, state: "postmarket" });
    expect(postmarket.label).toBe("premium");
    expect(postmarket.sentence).toMatch(/real share/i);
    expect(postmarket.sentence).not.toMatch(/spread|gap|venue|bps/i);

    const premarket = classifySpread({ gapPct: PREMIUM_THRESHOLD_PCT + 2, buyable: true, state: "premarket" });
    expect(premarket.label).toBe("premium");
  });

  it("flags a discount only while buyable AND below the threshold", () => {
    const cheapAndBuyable = classifySpread({ gapPct: -(DISCOUNT_THRESHOLD_PCT + 2), buyable: true, state: "open" });
    expect(cheapAndBuyable.label).toBe("discount");
    expect(cheapAndBuyable.sentence).toMatch(/less than the real share/i);

    const cheapNotBuyable = classifySpread({ gapPct: -(DISCOUNT_THRESHOLD_PCT + 2), buyable: false, state: "closed" });
    expect(cheapNotBuyable.label).not.toBe("discount");
  });

  it("is in_line when neither threshold is cleared, and unknown with no usable gap", () => {
    expect(classifySpread({ gapPct: 0.1, buyable: true, state: "open" }).label).toBe("in_line");
    expect(classifySpread({ gapPct: null, buyable: true, state: "open" }).label).toBe("unknown");
  });

  it("honours a caller-supplied threshold instead of the constant", () => {
    const r = classifySpread({ gapPct: 0.6, buyable: true, state: "closed" }, { premiumPct: 0.5 });
    expect(r.label).toBe("premium");
  });
});

describe("issuerDifference", () => {
  it("is null when the ticker isn't dual-listed (only one platform present)", () => {
    expect(issuerDifference("AAPL", [{ platform: "ondo", tokenPrice: 200, buyable: true }])).toBeNull();
  });

  it("picks the cheaper and pricier platform and the dollar/percent difference between them", () => {
    const d = issuerDifference("NVDA", [
      { platform: "bstock", tokenPrice: 100.4, buyable: true },
      { platform: "ondo", tokenPrice: 100.0, buyable: false },
    ]);
    expect(d).not.toBeNull();
    expect(d!.cheaper).toBe("ondo");
    expect(d!.pricier).toBe("bstock");
    expect(d!.diffUsd).toBeCloseTo(0.4, 6);
    expect(d!.diffPct).toBeCloseTo(0.4, 2);
    expect(d!.cheaperBuyable).toBe(false);
    expect(d!.pricierBuyable).toBe(true);
  });
});

describe("rankIssuerBoard", () => {
  it("sorts dual-listed tickers by the largest issuer difference first, and drops single-venue ones", () => {
    const board = rankIssuerBoard([
      {
        ticker: "SMALL",
        venues: [
          { platform: "bstock", tokenPrice: 10.01, buyable: true },
          { platform: "ondo", tokenPrice: 10.0, buyable: true },
        ],
      },
      {
        ticker: "BIG",
        venues: [
          { platform: "bstock", tokenPrice: 105, buyable: true },
          { platform: "ondo", tokenPrice: 100, buyable: true },
        ],
      },
      { ticker: "ONE_VENUE", venues: [{ platform: "bstock", tokenPrice: 50, buyable: true }] },
    ]);
    expect(board.map((r) => r.ticker)).toEqual(["BIG", "SMALL"]);
  });
});

describe("issuerDiffSentence", () => {
  it("reads as a plain sentence naming both issuers and the dollar gap", () => {
    const s = issuerDiffSentence({ cheaper: "ondo", pricier: "bstock", diffUsd: 0.4 });
    expect(s).toBe("Ondo is $0.40 cheaper than bStock right now");
  });
});

describe("platformLabel", () => {
  it("maps the wire names to display names", () => {
    expect(platformLabel("bstock")).toBe("bStock");
    expect(platformLabel("ondo")).toBe("Ondo");
  });
});

describe("cheaperIssuerNow", () => {
  it("picks the cheaper of the two when both are buyable", () => {
    expect(
      cheaperIssuerNow([
        { platform: "bstock", tokenPrice: 101, buyable: true },
        { platform: "ondo", tokenPrice: 99, buyable: true },
      ]),
    ).toBe("ondo");
  });

  it("prefers whichever is buyable over a cheaper but closed venue", () => {
    expect(
      cheaperIssuerNow([
        { platform: "bstock", tokenPrice: 99, buyable: false },
        { platform: "ondo", tokenPrice: 101, buyable: true },
      ]),
    ).toBe("ondo");
  });

  it("falls back to the plain cheaper price when neither is buyable", () => {
    expect(
      cheaperIssuerNow([
        { platform: "bstock", tokenPrice: 99, buyable: false },
        { platform: "ondo", tokenPrice: 101, buyable: false },
      ]),
    ).toBe("bstock");
  });

  it("is null with no bStock/Ondo venue at all", () => {
    expect(cheaperIssuerNow([])).toBeNull();
  });
});
