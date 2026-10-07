import { describe, expect, it } from "vitest";
import { AWARDS, ELIGIBILITY, OFFER_DESCRIPTION, SITE_DESCRIPTION } from "./seo";
import { STAX_FEE_PCT } from "./fees";

describe("seo copy", () => {
  it("keeps the meta description short enough for a search snippet", () => {
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(200);
  });

  it("leads with BNB Chain and its two issuers", () => {
    expect(SITE_DESCRIPTION).toMatch(/BNB Chain/);
    expect(SITE_DESCRIPTION).toMatch(/bStock/);
    expect(SITE_DESCRIPTION).toMatch(/Ondo/);
  });

  it("claims no contract check it can't back on the default network", () => {
    expect(SITE_DESCRIPTION).not.toMatch(/contract/i);
  });

  it("names every issuer and keeps the non-US condition", () => {
    expect(ELIGIBILITY).toBe(
      "Stocks are issued by bStock and Ondo on BNB Chain, Coinbase on Base and Backed on Mantle, for eligible non-US users.",
    );
  });

  it("keeps both awards, each with its citation", () => {
    expect(AWARDS.map((a) => a.name)).toEqual(["Track Winner, Trading & Strategy", "Best UI/UX"]);
    for (const a of AWARDS) expect(a.url).toMatch(/^https:\/\/x\.com\/Mantle_Official\/status\/\d+$/);
  });
});

describe("structured-data offer", () => {
  it("doesn't claim trading is free everywhere: Base and Mantle charge the flat fee", () => {
    expect(OFFER_DESCRIPTION).not.toMatch(/trading fees are covered/i);
    expect(OFFER_DESCRIPTION).toMatch(/No Stax fee on BNB Chain/);
    expect(OFFER_DESCRIPTION).toContain(`${STAX_FEE_PCT}%`);
    expect(OFFER_DESCRIPTION).toMatch(/Base and Mantle/);
  });
});
