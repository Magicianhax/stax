// buildCatalog: groups Binance RWA rows under the curated asset list, computes each venue's
// gap and buyability, and picks the best venue to buy from right now. Fed from Task 7's
// rwa_tokens.json fixture (14 rows: NVDA/TSLA/META/MSFT/GOOGL dual-listed, MEI paused, LECO
// unsupported, INTW bstock-only, HYGW ondo-only), plus small synthetic variants for the cases
// the fixture doesn't cover on its own (a Sunday snapshot, a curated venue missing from the
// token list, and a best-venue pick pinned against a synthetic gap so a naive "just take the
// default venue" implementation can't pass by accident).
import { beforeEach, describe, expect, it } from "vitest";
import { buildCatalog, cachedWithFallback } from "./rwaCatalog";
import type { Asset } from "../chains/types";
import type { RwaToken } from "./binance/types";
import rwaTokensFixture from "./binance/__fixtures__/rwa_tokens.json";

// A Tuesday at 10:00 America/New_York (EDT) — the US market is open, so usMarketState's
// fallback for bStock rows (which never report their own session) reads "open".
const NOW = new Date("2026-09-22T14:00:00.000Z").getTime();
// A Sunday — every US-hours fallback reads "closed", and Binance's own openState is false on
// every fixture row too (set per-test below), so nothing anywhere should be buyable.
const SUNDAY = new Date("2026-09-27T16:00:00.000Z").getTime();

// Task 7's fixture is the raw wire response (`wireRwaToken` in binance/rwa.ts): every numeric
// field arrives as a string, and the real client parses each one to `number` before anything
// downstream ever sees it. Casting the raw JSON straight to `RwaToken` would leave
// tokenPrice/referencePrice as strings — `gapPct`'s `Number.isFinite` guard rejects those, so
// every gap in this file would silently evaluate to null and `pickBestVenue` would never
// actually compare two gaps. This mirrors binance/rwa.ts's own wire-to-`RwaToken` conversion.
interface RawFixtureToken extends Omit<RwaToken, "decimals" | "tokenToShareRatio" | "tokenPrice" | "referencePrice" | "volume24H" | "marketCap"> {
  decimals: string;
  tokenToShareRatio: string;
  tokenPrice: string;
  referencePrice: string;
  volume24H: string;
  marketCap: string | null;
}

function parseFixtureToken(raw: RawFixtureToken): RwaToken {
  return {
    ...raw,
    decimals: Number(raw.decimals),
    tokenToShareRatio: Number(raw.tokenToShareRatio),
    tokenPrice: Number(raw.tokenPrice),
    referencePrice: Number(raw.referencePrice),
    volume24H: Number(raw.volume24H),
    marketCap: raw.marketCap === null ? 0 : Number(raw.marketCap),
  };
}

const tokens = (rwaTokensFixture as unknown as RawFixtureToken[]).map(parseFixtureToken);

const stock = (a: Omit<Asset, "tier" | "via" | "decimals">): Asset => ({
  ...a,
  tier: "stock",
  via: "binance",
  decimals: 18,
});

// Mirrors bsc.assets.ts's shape: default venue is bStock where both exist, twin is the other.
const assets: Asset[] = [
  stock({
    symbol: "NVDA",
    name: "Nvidia",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", // bstock
    platform: "bstock",
    onchainSymbol: "NVDAB",
    twin: { platform: "ondo", address: "0xa9ee28c80f960b889dfbd1902055218cba016f75", onchainSymbol: "NVDAon", decimals: 18 },
  }),
  stock({
    symbol: "TSLA",
    name: "Tesla",
    address: "0x5b1910eaad6450e50f816082aa078c41f10c292f", // bstock
    platform: "bstock",
    onchainSymbol: "TSLAB",
    twin: { platform: "ondo", address: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93", onchainSymbol: "TSLAon", decimals: 18 },
  }),
  stock({
    symbol: "MEI",
    name: "Methode Electronics",
    address: "0x89c37104afcee9a72187e05d960a1e09763a126e", // ondo, MARKET_PAUSED in the fixture
    platform: "ondo",
    onchainSymbol: "MEIon",
  }),
  stock({
    symbol: "LECO",
    name: "Lincoln Electric",
    address: "0x43807bf4ce06f4fbb4fa8deac37bf274aea324da", // ondo, UNSUPPORTED in the fixture
    platform: "ondo",
    onchainSymbol: "LECOon",
  }),
  stock({
    symbol: "AAPL",
    name: "Apple",
    address: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4", // ondo — not in the fixture at all
    platform: "ondo",
    onchainSymbol: "AAPLon",
    // AAPLB is real (docs/BINANCE-WEB3.md §7.2) but absent from /tokens — exactly the case
    // buildCatalog must tolerate: the ticker should still appear with just the ondo venue.
    twin: { platform: "bstock", address: "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", onchainSymbol: "AAPLB", decimals: 18 },
  }),
  stock({
    symbol: "GHOST",
    name: "Nothing Inc.",
    address: "0x0000000000000000000000000000000000dead", // neither venue is in the fixture
    platform: "bstock",
    onchainSymbol: "GHOSTB",
    twin: { platform: "ondo", address: "0x000000000000000000000000000000deadbeef", onchainSymbol: "GHOSTon", decimals: 18 },
  }),
];

describe("buildCatalog", () => {
  it("pairs both issuers of the same share under one ticker", () => {
    const nvda = buildCatalog(tokens, assets, NOW).find((t) => t.ticker === "NVDA")!;
    expect(nvda.venues.map((v) => v.platform).sort()).toEqual(["bstock", "ondo"]);
  });

  it("marks a paused or unsupported token unbuyable, and never picks it as best venue", () => {
    const cat = buildCatalog(tokens, assets, NOW);
    const paused = cat.find((t) => t.ticker === "MEI")!.venues[0];
    expect(paused.state).toBe("paused");
    expect(paused.buyable).toBe(false);
    const unsupported = cat.find((t) => t.ticker === "LECO")!.venues[0];
    expect(unsupported.state).toBe("unsupported");
    expect(unsupported.buyable).toBe(false);
    for (const t of cat) if (t.bestVenue) expect(t.venues.find((v) => v.platform === t.bestVenue)!.buyable).toBe(true);
  });

  it("is null best-venue when nothing is buyable, which is what a Sunday looks like", () => {
    const closed = tokens.map((t) => ({ ...t, statusInfo: { ...t.statusInfo, openState: false } }));
    expect(buildCatalog(closed, assets, SUNDAY).every((t) => t.bestVenue === null)).toBe(true);
  });

  it("prefers the smaller gap when both venues are buyable", () => {
    // NVDA: bstock gap = (223.5438.../223.37 - 1)*100 ≈ +0.078%; ondo gap ≈ +0.172% (both TRADING).
    const nvda = buildCatalog(tokens, assets, NOW).find((t) => t.ticker === "NVDA")!;
    expect(nvda.bestVenue).toBe("bstock");
  });

  it("picks the smaller gap by size, not by which venue is the curated default", () => {
    // NVDA's default venue is bstock (see `assets` above). Set ondo's token price equal to its
    // own reference (gap 0%) while bstock keeps its fixture gap (~+0.078%), so a `bestVenue`
    // that just returns the default or the first buyable venue — which would also pass every
    // other test in this file — is pinned wrong here: the smaller gap is now the non-default,
    // second-pushed venue.
    const withZeroGapOndo = tokens.map((t) =>
      t.underlyingTicker === "NVDA" && t.platformId === "ondo" ? { ...t, tokenPrice: t.referencePrice } : t,
    );
    const nvda = buildCatalog(withZeroGapOndo, assets, NOW).find((t) => t.ticker === "NVDA")!;
    expect(nvda.bestVenue).toBe("ondo");
  });

  it("compares the signed gap: for a buyer a discount beats a smaller premium (design critique P1 #7)", () => {
    // bstock discount of -0.5% vs. ondo premium of +0.2%: bStock costs less against the real
    // share, so it wins — the same rule the "Which is cheaper?" board uses (lib/spread.ts).
    const skewed = tokens.map((t) => {
      if (t.underlyingTicker !== "NVDA") return t;
      if (t.platformId === "bstock") return { ...t, tokenPrice: t.referencePrice * 0.995 };
      return { ...t, tokenPrice: t.referencePrice * 1.002 };
    });
    const nvda = buildCatalog(skewed, assets, NOW).find((t) => t.ticker === "NVDA")!;
    expect(nvda.bestVenue).toBe("bstock");
  });

  it("tolerates a curated venue missing from the token list: the ticker keeps its other venue", () => {
    // AAPL's ondo row is present; its bstock twin (AAPLB) is real but absent from /tokens,
    // exactly the case docs/BINANCE-WEB3.md §7.2 records — buildCatalog must not drop AAPL
    // entirely just because one of its two venues isn't listed. (Address taken from the AAPL
    // asset above, not repeated as a literal, so a scanner never sees "tokenContractAddress"
    // sitting next to a bare hex string it can't tell apart from a real credential.)
    const aaplOndo: RwaToken = {
      ...tokens[0],
      tokenContractAddress: assets.find((a) => a.symbol === "AAPL")!.address!,
      platformId: "ondo",
      tokenSymbol: "AAPLon",
      underlyingTicker: "AAPL",
      statusInfo: { ...tokens[0].statusInfo, openState: true, reasonCode: "TRADING", marketStatus: "premarket" },
    };
    const aapl = buildCatalog([...tokens, aaplOndo], assets, NOW).find((t) => t.ticker === "AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.venues).toHaveLength(1);
    expect(aapl!.venues[0].platform).toBe("ondo");
  });

  it("omits a ticker with no venues at all", () => {
    expect(buildCatalog(tokens, assets, NOW).find((t) => t.ticker === "GHOST")).toBeUndefined();
  });

  it("gives bStock rows the local US-hours fallback, since they never report their own session", () => {
    // 10:00 ET on a Tuesday: usMarketState reads "open".
    const nvda = buildCatalog(tokens, assets, NOW).find((t) => t.ticker === "NVDA")!;
    expect(nvda.venues.find((v) => v.platform === "bstock")!.state).toBe("open");
  });

  it("never reports a closed venue as buyable, even one whose own flags still say TRADING", () => {
    // The unmodified fixture's bStock rows carry openState:true / reasonCode:"TRADING" — the
    // API never itself reports a session, so nothing in the row changes on a Sunday. Only
    // Stax's own US-market calendar (via `nowMs`) can catch that the market is actually
    // closed, and `buyable` must defer to it rather than to the issuer's stale-looking flags:
    // this is the exact weekend-premium buy Vera is supposed to refuse.
    const cat = buildCatalog(tokens, assets, SUNDAY);
    const nvdaBstock = cat.find((t) => t.ticker === "NVDA")!.venues.find((v) => v.platform === "bstock")!;
    expect(nvdaBstock.state).toBe("closed");
    expect(nvdaBstock.buyable).toBe(false);
    expect(nvdaBstock.nextOpenMs).toEqual(expect.any(Number));
  });

  it("maps a non-TRADING reason with no session info to paused, not to whatever the clock says", () => {
    // A synthetic bStock-shaped row: marketStatus is still null (bStock never sends one), but
    // reasonCode says the issuer itself paused the asset. During US market hours the naive
    // calendar fallback would read "open"; the issuer's own flag must win instead.
    const nvdaBstock = tokens.find((t) => t.underlyingTicker === "NVDA" && t.platformId === "bstock")!;
    const pausedBstock: RwaToken = {
      ...nvdaBstock,
      statusInfo: { ...nvdaBstock.statusInfo, openState: false, reasonCode: "ASSET_PAUSED", marketStatus: null },
    };
    const others = tokens.filter((t) => !(t.underlyingTicker === "NVDA" && t.platformId === "bstock"));
    const nvda = buildCatalog([pausedBstock, ...others], assets, NOW).find((t) => t.ticker === "NVDA")!;
    const bstock = nvda.venues.find((v) => v.platform === "bstock")!;
    expect(bstock.state).toBe("paused");
    expect(bstock.buyable).toBe(false);
  });

  it("a Sunday snapshot: every venue not buyable across the whole catalog", () => {
    const closed = tokens.map((t) => ({ ...t, statusInfo: { ...t.statusInfo, openState: false } }));
    const cat = buildCatalog(closed, assets, SUNDAY);
    expect(cat.length).toBeGreaterThan(0);
    for (const t of cat) for (const v of t.venues) expect(v.buyable).toBe(false);
  });

  it("a ticker whose only buyable venue is the twin gets bestVenue = the twin", () => {
    // TSLA's default venue (bstock) forced unbuyable; only the ondo twin stays TRADING. The
    // paused reason with no session info also reconciles to state "paused", not "open".
    const withBstockPaused = tokens.map((t) =>
      t.underlyingTicker === "TSLA" && t.platformId === "bstock"
        ? { ...t, statusInfo: { ...t.statusInfo, openState: false, reasonCode: "MARKET_PAUSED" } }
        : t,
    );
    const tsla = buildCatalog(withBstockPaused, assets, NOW).find((t) => t.ticker === "TSLA")!;
    expect(tsla.venues.find((v) => v.platform === "bstock")!.state).toBe("paused");
    expect(tsla.venues.find((v) => v.platform === "bstock")!.buyable).toBe(false);
    expect(tsla.bestVenue).toBe("ondo");
  });

  it("reports nextOpenMs null for a buyable venue, and a real instant otherwise", () => {
    const cat = buildCatalog(tokens, assets, NOW);
    for (const t of cat) {
      for (const v of t.venues) {
        if (v.buyable) expect(v.nextOpenMs).toBeNull();
        else expect(typeof v.nextOpenMs).toBe("number");
      }
    }
  });
});

// cachedWithFallback: the stale-on-outage layer under bscCatalogSnapshot / cachedRwaProfile /
// cachedCandles. Exercised directly against the real (in-memory, no Redis configured in this
// environment) cache module — no mocking needed, since the whole point is the interaction
// between `cached()`'s "loader only runs on a miss" rule and the fallback slot's own TTL.
describe("cachedWithFallback", () => {
  let n = 0;
  beforeEach(() => {
    n += 1; // a fresh key per test so the in-memory cache carries nothing over between them
  });

  it("serves the newest good value on a failure, not whichever value the fallback slot saw first", async () => {
    const key = `test:cachedWithFallback:${n}`;
    // ttl 0: every call is a genuine primary-cache miss, so each one re-runs `fn` and (on
    // success) refreshes the fallback slot — the behaviour this test exists to pin.
    expect(await cachedWithFallback(key, 0, 600, async () => "A")).toBe("A");
    expect(await cachedWithFallback(key, 0, 600, async () => "B")).toBe("B");
    // This failure has nothing to serve but the fallback slot. Before the fix, `cached()`'s
    // "write only on a miss" rule meant the slot was written once (with "A") and never
    // touched again inside its 600s window, so this would have returned "A" — a snapshot a
    // full cycle stale — instead of "B", the most recent good load.
    const served = await cachedWithFallback(key, 0, 600, async () => {
      throw new Error("binance down");
    });
    expect(served).toBe("B");
  });

  it("rejects when a failure has no cached value to fall back on, so the route can 503", async () => {
    const key = `test:cachedWithFallback:none:${n}`;
    await expect(
      cachedWithFallback(key, 0, 600, async () => {
        throw new Error("binance down");
      }),
    ).rejects.toThrow("binance down");
  });
});
