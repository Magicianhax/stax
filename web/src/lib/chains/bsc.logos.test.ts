// Coverage guard for bsc.logos.ts: every BSC tokenized stock's default AND twin address must
// carry its issuer's own official logo (bStock and Ondo brand their tokens differently — a
// missing entry here is exactly the "shows a letter" / "shows the wrong issuer's logo" bug this
// data file exists to fix). Crypto (BTCB/ETH/BNB) is out of scope: those aren't RWA tokens and
// keep displayAssets.ts's crypto-icon logos instead.
import { describe, expect, it } from "vitest";
import { BSC_STOCKS } from "./bsc.assets";
import { BSC_LOGOS } from "./bsc.logos";

describe("BSC_LOGOS coverage", () => {
  it("gives every stock's own address a logo", () => {
    for (const asset of BSC_STOCKS) {
      expect(asset.logo, `${asset.symbol} (${asset.address}) has no logo`).toBeTruthy();
      expect(asset.address).toBeDefined();
      expect(BSC_LOGOS[asset.address!.toLowerCase()]).toBe(asset.logo);
    }
  });

  it("gives every twin's address a logo, from the twin's own issuer", () => {
    for (const asset of BSC_STOCKS) {
      if (!asset.twin) continue;
      expect(asset.twin.logo, `${asset.symbol} twin (${asset.twin.address}) has no logo`).toBeTruthy();
      expect(BSC_LOGOS[asset.twin.address.toLowerCase()]).toBe(asset.twin.logo);
      // The two issuers of the same ticker never share one logo (design bug this file fixes) —
      // except AAPL/AAPLB, which is a documented fallback: bStock's Apple mint is missing from
      // `/tokens` and has no logo of its own to differ from.
      if (asset.symbol !== "AAPL") {
        expect(asset.twin.logo).not.toBe(asset.logo);
      }
    }
  });

  it("keys are lowercase, matching how bsc.assets.ts addresses are compared", () => {
    for (const key of Object.keys(BSC_LOGOS)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});
