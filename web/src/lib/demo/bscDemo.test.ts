import { describe, expect, it } from "vitest";
import { BSC } from "@/lib/chains/bsc";
import { assetBySymbol } from "@/lib/chains";
import { usMarketState } from "@/lib/marketHours";
import { BSC_MIN_LEG_USD } from "@/lib/rwa";
import { SwapQuoteError } from "@/lib/swapQuote";
import { txUrl } from "@/lib/format";
import { buildDemoEarnings, buildDemoRwa, buildDemoSpreadBoard, buildDemoSpreadHistory, demoClock, demoQuote, gapAt, venueSession } from "@/lib/demo/bscMarket";
import { DemoRefusal, cryptoShareFrom, demoBscAllocate, demoBscDryRuns, demoBscPlanFills, demoBscSuccess, demoPlanLegs, demoTxHash, wholeWeights } from "@/lib/demo/bscVera";
import { buildBscWorld, BSC_HOLDING_SEEDS } from "@/lib/demo/bscWorld";
import { demoWorldFor } from "@/lib/demo/world";

// Wed 7 Oct 2026, 15:00 UTC = 11:00 in New York (regular session).
const OPEN = Date.UTC(2026, 9, 7, 15, 0, 0);
// Wed 7 Oct 2026, 23:30 UTC = 19:30 in New York (after the bell).
const AFTER = Date.UTC(2026, 9, 7, 23, 30, 0);
// Thu 8 Oct 2026, 02:00 UTC = 22:00 in New York (overnight).
const NIGHT = Date.UTC(2026, 9, 8, 2, 0, 0);
// Sat 10 Oct 2026, 15:00 UTC (weekend).
const WEEKEND = Date.UTC(2026, 9, 10, 15, 0, 0);

describe("the demo clock", () => {
  it("fixtures are the sessions they claim to be", () => {
    expect(usMarketState(OPEN)).toBe("open");
    expect(usMarketState(AFTER)).toBe("postmarket");
    expect(usMarketState(NIGHT)).toBe("overnight");
    expect(usMarketState(WEEKEND)).toBe("closed");
  });

  it("live follows the real clock", () => {
    for (const t of [OPEN, AFTER, NIGHT, WEEKEND]) expect(demoClock("live", t)).toBe(t);
  });

  it("open stays put during the session and moves to the next one otherwise", () => {
    expect(demoClock("open", OPEN)).toBe(OPEN);
    for (const t of [AFTER, NIGHT, WEEKEND]) {
      const c = demoClock("open", t);
      expect(c).toBeGreaterThan(t);
      expect(usMarketState(c)).toBe("open");
    }
  });

  it("closed stays put on a weekend and moves to one otherwise", () => {
    expect(demoClock("closed", WEEKEND)).toBe(WEEKEND);
    for (const t of [OPEN, AFTER, NIGHT]) {
      const c = demoClock("closed", t);
      expect(c).toBeGreaterThan(t);
      expect(usMarketState(c)).toBe("closed");
    }
  });
});

describe("issuer sessions", () => {
  it("both issuers trade the session and the hours around it", () => {
    for (const t of [OPEN, AFTER]) {
      expect(venueSession("NVDA", "bstock", t).buyable).toBe(true);
      expect(venueSession("NVDA", "ondo", t).buyable).toBe(true);
    }
  });

  it("only Ondo trades overnight, and nobody on a weekend", () => {
    expect(venueSession("NVDA", "bstock", NIGHT).buyable).toBe(false);
    expect(venueSession("NVDA", "ondo", NIGHT).buyable).toBe(true);
    expect(venueSession("NVDA", "bstock", WEEKEND)).toEqual({ state: "closed", buyable: false });
    expect(venueSession("NVDA", "ondo", WEEKEND)).toEqual({ state: "closed", buyable: false });
  });

  it("one demo pause: TSLA at bStock", () => {
    expect(venueSession("TSLA", "bstock", OPEN)).toEqual({ state: "paused", buyable: false });
    expect(venueSession("TSLA", "ondo", OPEN).buyable).toBe(true);
  });
});

describe("price against the real share", () => {
  it("hugs the real share in session and sits above it when the market is shut", () => {
    for (const s of ["NVDA", "AAPL", "MSFT", "QQQ"]) {
      for (const p of ["bstock", "ondo"] as const) {
        expect(Math.abs(gapAt(s, p, OPEN))).toBeLessThan(0.5);
        expect(gapAt(s, p, WEEKEND)).toBeGreaterThan(0.5);
      }
    }
  });

  it("Ondo drifts further above than bStock on a weekend, for every dual-listed ticker", () => {
    const dual = BSC.assets.stocks.filter((a) => a.twin && a.risk !== "preipo");
    const farther = dual.filter((a) => gapAt(a.symbol, "ondo", WEEKEND) > gapAt(a.symbol, "bstock", WEEKEND));
    expect(farther.length / dual.length).toBeGreaterThan(0.8);
  });

  it("has one discount worth buying while the market is open (AMD at Ondo)", () => {
    expect(gapAt("AMD", "ondo", OPEN)).toBeLessThan(-1);
  });

  it("is the same number wherever it is read from", () => {
    const rwa = buildDemoRwa(OPEN);
    const nvda = rwa.tickers.find((t) => t.ticker === "NVDA")!;
    const hist = buildDemoSpreadHistory("NVDA", OPEN)!;
    for (const v of nvda.venues) {
      const last = hist.venues.find((h) => h.platform === v.platform)!.points.at(-1)!;
      expect(last.t).toBe(OPEN);
      expect(last.tokenPrice).toBe(v.tokenPrice);
      expect(last.referencePrice).toBe(v.referencePrice);
      expect(last.gapPct).toBe(v.gapPct);
    }
  });
});

describe("the demo catalog", () => {
  const open = buildDemoRwa(OPEN);
  const weekend = buildDemoRwa(WEEKEND);

  it("lists every curated BNB Chain stock with the issuers it really has", () => {
    expect(open.tickers).toHaveLength(BSC.assets.stocks.length);
    expect(open.tickers.length).toBe(42);
    for (const a of BSC.assets.stocks) {
      const t = open.tickers.find((x) => x.ticker === a.symbol)!;
      expect(t.venues).toHaveLength(a.twin ? 2 : 1);
      expect(t.venues[0].address.toLowerCase()).toBe(a.address!.toLowerCase());
      if (a.twin) expect(t.venues[1].address.toLowerCase()).toBe(a.twin.address.toLowerCase());
    }
    const dual = open.tickers.filter((t) => t.venues.length === 2).length;
    expect(dual).toBe(41); // most are offered by both issuers; AMZN only by Ondo
  });

  it("is open for everything but the paused issuer during the session", () => {
    const tsla = open.tickers.find((t) => t.ticker === "TSLA")!;
    expect(tsla.venues.find((v) => v.platform === "bstock")!.state).toBe("paused");
    expect(tsla.bestVenue).toBe("ondo");
    expect(open.tickers.filter((t) => t.bestVenue === null)).toHaveLength(0);
  });

  it("is shut on a weekend: nothing buyable, every venue says when it opens", () => {
    expect(weekend.tickers.every((t) => t.bestVenue === null)).toBe(true);
    for (const v of weekend.tickers.flatMap((t) => t.venues)) {
      expect(v.buyable).toBe(false);
      expect(v.nextOpenMs).toBeGreaterThan(WEEKEND);
    }
  });

  it("picks the issuer closest to the real share as the best venue", () => {
    const amd = open.tickers.find((t) => t.ticker === "AMD")!;
    expect(amd.bestVenue).toBe("ondo");
  });

  it("board and calls come from the app's own rules", () => {
    const board = buildDemoSpreadBoard(weekend);
    expect(board.board.length).toBeGreaterThan(30);
    expect(board.board[0].diffUsd).toBeGreaterThanOrEqual(board.board.at(-1)!.diffUsd);
    const nvda = board.tickers.find((t) => t.ticker === "NVDA")!;
    expect(nvda.venues.every((v) => v.call.label === "premium")).toBe(true);
    const openCalls = buildDemoSpreadBoard(open).tickers.find((t) => t.ticker === "AMD")!;
    expect(openCalls.venues.find((v) => v.platform === "ondo")!.call.label).toBe("discount");
  });

  it("keeps seven days of history, newest last", () => {
    const h = buildDemoSpreadHistory("AAPL", OPEN)!;
    expect(h.venues).toHaveLength(2);
    const pts = h.venues[0].points;
    expect(pts).toHaveLength(112);
    expect(pts[0].t).toBeLessThan(pts.at(-1)!.t);
    expect(pts.at(-1)!.t - pts[0].t).toBeGreaterThan(6.5 * 86_400_000);
    expect(buildDemoSpreadHistory("BTCB", OPEN)).toBeNull();
  });

  it("gives funds and pre-IPO names no earnings date, and everyone else a future one", () => {
    const e = buildDemoEarnings(OPEN);
    expect(e.SPY.nextMs).toBeNull();
    expect(e.CBRS.nextMs).toBeNull();
    expect(e.NVDA.nextMs).toBeGreaterThan(OPEN);
    // SpaceX is listed now, so it reports like any other company.
    expect(e.SPCX.nextMs).toBeGreaterThan(OPEN);
  });
});

describe("demo quotes", () => {
  const rwa = buildDemoRwa(OPEN);
  const closed = buildDemoRwa(WEEKEND);
  const nvda = assetBySymbol(BSC, "NVDA")!;
  const usdt = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(10) ** BigInt(12);

  it("quotes a buy against the issuer's own price and passes the Binance check", () => {
    const q = demoQuote({ asset: nvda, side: "buy", amountIn: usdt(50), rwa, nowMs: OPEN });
    const price = rwa.tickers.find((t) => t.ticker === "NVDA")!.venues[0].tokenPrice;
    const qty = Number(q.amountOut) / 1e18;
    expect(qty).toBeGreaterThan((50 / price) * 0.99);
    expect(qty).toBeLessThan(50 / price);
    expect(q.minOut).toBeLessThan(q.amountOut);
    expect(q.router).toBe("0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5");
    expect(q.tokenIn.toLowerCase()).toBe(BSC.usdc.address.toLowerCase());
    expect(q.dryRun.status).toBe("passed");
    expect(q.dryRun.receiveRaw).toBe(q.amountOut.toString());
  });

  it("buys the twin's own token when the visitor picks it", () => {
    const q = demoQuote({ asset: nvda, side: "buy", amountIn: usdt(20), venue: "ondo", rwa, nowMs: OPEN });
    expect(q.tokenOut.toLowerCase()).toBe(nvda.twin!.address.toLowerCase());
  });

  it("refuses $5 or less and says the minimum", () => {
    expect(() => demoQuote({ asset: nvda, side: "buy", amountIn: usdt(5), rwa, nowMs: OPEN })).toThrowError(SwapQuoteError);
    try {
      demoQuote({ asset: nvda, side: "buy", amountIn: usdt(4), rwa, nowMs: OPEN });
    } catch (e) {
      expect((e as SwapQuoteError).code).toBe("min_trade");
      expect((e as SwapQuoteError).message).toContain(`$${BSC_MIN_LEG_USD}`);
    }
    expect(() => demoQuote({ asset: nvda, side: "buy", amountIn: usdt(6), rwa, nowMs: OPEN })).not.toThrow();
  });

  it("refuses a closed market with when it opens", () => {
    try {
      demoQuote({ asset: nvda, side: "buy", amountIn: usdt(50), rwa: closed, nowMs: WEEKEND });
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(SwapQuoteError);
      expect((e as SwapQuoteError).code).toBe("closed");
      expect((e as SwapQuoteError).nextOpenMs).toBeGreaterThan(WEEKEND);
    }
  });

  it("refuses a paused issuer but not its twin", () => {
    const tsla = assetBySymbol(BSC, "TSLA")!;
    expect(() => demoQuote({ asset: tsla, side: "buy", amountIn: usdt(20), rwa, nowMs: OPEN })).toThrowError(SwapQuoteError);
    expect(() => demoQuote({ asset: tsla, side: "buy", amountIn: usdt(20), venue: "ondo", rwa, nowMs: OPEN })).not.toThrow();
  });

  it("quotes crypto any hour, with no issuer", () => {
    const btcb = assetBySymbol(BSC, "BTCB")!;
    const q = demoQuote({ asset: btcb, side: "buy", amountIn: usdt(30), rwa: closed, nowMs: WEEKEND });
    expect(q.tokenOut.toLowerCase()).toBe(btcb.address!.toLowerCase());
    expect(Number(q.amountOut) / 1e18).toBeCloseTo(30 / 84000, 4);
  });

  it("quotes a sell in dollars", () => {
    const q = demoQuote({ asset: nvda, side: "sell", amountIn: BigInt(2) * BigInt(10) ** BigInt(18), rwa, nowMs: OPEN });
    const price = rwa.tickers.find((t) => t.ticker === "NVDA")!.venues[0].tokenPrice;
    expect(Number(q.amountOut) / 1e18).toBeCloseTo(2 * price * 0.9985, 1);
    expect(q.tokenOut.toLowerCase()).toBe(BSC.usdc.address.toLowerCase());
  });
});

describe("Vera in the demo", () => {
  const rwa = buildDemoRwa(OPEN);
  const closed = buildDemoRwa(WEEKEND);
  const plan = (goal: string, amountUsd: number, risk?: string, r = rwa, nowMs = OPEN) => demoBscAllocate({ goal, amountUsd, risk, rwa: r, nowMs });

  it("plans from what is buyable, with whole weights that add to 100", () => {
    const p = plan("Grow $200, mostly big tech, keep some safe", 200);
    expect(p.chain).toBe("bsc");
    expect(p.allocations.reduce((s, a) => s + a.weightPct, 0)).toBe(100);
    for (const a of p.allocations) {
      expect(Number.isInteger(a.weightPct)).toBe(true);
      const t = rwa.tickers.find((x) => x.ticker === a.symbol)!;
      expect(t.bestVenue).toBe(a.venue);
      expect(a.address).toBe(t.venues.find((v) => v.platform === a.venue)!.address);
      expect(a.reason.length).toBeGreaterThan(5);
    }
  });

  it("keeps every stock at $6 or more, dropping the smallest first", () => {
    for (const amount of [6, 11, 25, 40, 150, 1000]) {
      const p = plan("Grow it", amount);
      for (const a of p.allocations) expect((amount * a.weightPct) / 100).toBeGreaterThanOrEqual(BSC_MIN_LEG_USD - 0.06);
    }
    expect(plan("Grow it", 6).allocations).toHaveLength(1);
  });

  it("refuses under $6 and says the smallest amount", () => {
    expect(() => plan("Grow it", 5)).toThrowError(DemoRefusal);
    expect(() => plan("Grow it", 5)).toThrowError(/\$6/);
  });

  it("never reaches for a leveraged fund, and skips the paused issuer's stock if it has no other", () => {
    const p = plan("Chips", 500, "aggressive");
    expect(p.allocations.map((a) => a.symbol)).not.toContain("SOXL");
    expect(p.allocations.map((a) => a.symbol)).not.toContain("TQQQ");
    const tsla = plan("I like Tesla", 100);
    for (const a of tsla.allocations) expect(a.venue).not.toBeUndefined();
  });

  it("builds a chips plan from chip makers", () => {
    const p = plan("Back the AI chip makers", 300);
    expect(p.allocations[0].symbol).toBe("NVDA");
    expect(p.summary).toMatch(/chips/i);
  });

  it("leads with the broad fund when a goal asks for a theme and some safety", () => {
    const p = plan("Grow $180, mostly big tech, keep a little safe", 180);
    expect(p.allocations[0].symbol).toBe("SPY");
    expect(p.allocations.map((a) => a.symbol)).toContain("AAPL");
    expect(p.summary).toMatch(/big-tech/i);
    expect(plan("Play it safe and still earn a bit", 180).allocations[0].symbol).toBe("SPY");
  });

  it("adds crypto only when asked, and not when the goal says no", () => {
    expect(cryptoShareFrom("mostly stocks")).toBe(0);
    expect(cryptoShareFrom("stocks on BNB Chain")).toBe(0);
    expect(cryptoShareFrom("no crypto please")).toBe(0);
    expect(cryptoShareFrom("some bitcoin")).toBe(20);
    expect(cryptoShareFrom("30% in crypto")).toBe(30);
    const p = plan("stocks and a bit of bitcoin", 200);
    const btcb = p.allocations.find((a) => a.symbol === "BTCB")!;
    expect(btcb.weightPct).toBe(20);
    expect(btcb.venue).toBeUndefined();
  });

  it("refuses to buy stocks when the market is shut, in plain words with when it opens", () => {
    try {
      plan("Grow $200", 200, undefined, closed, WEEKEND);
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(DemoRefusal);
      expect((e as Error).message).toMatch(/closed/);
      expect((e as Error).message).toMatch(/opens/);
      expect((e as Error).message).toMatch(/your time/);
    }
  });

  it("still plans crypto while the market is shut when asked for it", () => {
    const p = plan("some bitcoin", 100, undefined, closed, WEEKEND);
    expect(p.allocations.map((a) => a.symbol)).toEqual(["BTCB"]);
    expect(p.rationale).toMatch(/closed/);
  });

  it("splits whole-number weights exactly", () => {
    expect(wholeWeights([1, 1, 1])).toEqual([34, 33, 33]);
    expect(wholeWeights([50, 30, 20]).reduce((s, x) => s + x, 0)).toBe(100);
  });

  it("checks every stock with Binance and records one buy per stock under one transaction", () => {
    const p = plan("Grow $200, mostly big tech", 200);
    const dry = demoBscDryRuns(p, 200, rwa, OPEN);
    expect(dry.map((d) => d.symbol)).toEqual(p.allocations.map((a) => a.symbol));
    expect(dry.every((d) => d.status === "passed")).toBe(true);
    const tx = demoTxHash(1);
    const fills = demoBscPlanFills(p, 200, rwa, tx);
    expect(fills).toHaveLength(p.allocations.length);
    expect(fills.every((f) => f.kind === "trade" && f.txHash === tx)).toBe(true);
    const spent = fills.reduce((s, f) => s + (f.kind === "trade" ? f.usd : 0), 0);
    expect(spent).toBeCloseTo(200, 0);
    const legs = demoPlanLegs(p, 200, rwa);
    expect(legs.every((l) => l.qty > 0 && l.address.startsWith("0x"))).toBe(true);
    const success = demoBscSuccess(p, 200, tx);
    expect(success.verification).toBeUndefined();
    expect(success.holdings.reduce((s, h) => s + h.amountUsd, 0)).toBeCloseTo(200, 6);
  });

  it("makes hashes that look like hashes and differ per action", () => {
    expect(demoTxHash(1)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(demoTxHash(1)).not.toBe(demoTxHash(2));
  });
});

describe("the BNB Chain demo account", () => {
  const w = buildBscWorld({ nowMs: OPEN });

  it("holds bStock and Ondo stocks, one stock from both issuers, and a little Bitcoin", () => {
    const rows = w.portfolio.holdings;
    const nvda = rows.filter((h) => h.asset.symbol === "NVDA");
    expect(nvda.map((h) => h.venue).sort()).toEqual(["bstock", "ondo"]);
    expect(rows.some((h) => h.asset.symbol === "BTCB")).toBe(true);
    expect(rows.find((h) => h.asset.symbol === "BTCB")!.venue).toBeUndefined();
    expect(new Set(rows.filter((h) => h.venue).map((h) => h.venue))).toEqual(new Set(["bstock", "ondo"]));
    expect(rows).toHaveLength(BSC_HOLDING_SEEDS.length);
  });

  it("prices every row at its own issuer's price, so the totals agree", () => {
    for (const h of w.portfolio.holdings) {
      if (h.venue) {
        const v = w.rwa!.tickers.find((t) => t.ticker === h.asset.symbol)!.venues.find((x) => x.platform === h.venue)!;
        expect(h.priceUsd).toBe(v.tokenPrice);
      }
      expect(h.valueUsd).toBeCloseTo(h.qty * h.priceUsd!, 1);
      expect(h.raw).toBeGreaterThan(BigInt(0));
    }
    const sum = w.portfolio.holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
    expect(w.portfolio.investedUsd).toBeCloseTo(sum, 6);
    expect(w.portfolio.totalUsd).toBeCloseTo(sum + w.portfolio.cashUsd, 6);
  });

  it("keeps cash in USDT at 18 decimals", () => {
    expect(w.usdc.value).toBeCloseTo(184.37, 2);
    expect(w.usdc.raw).toBe(BigInt(18437) * BigInt(10) ** BigInt(16));
    expect(w.portfolio.cashUsd).toBe(w.usdc.value);
  });

  it("has a wallet history that lands exactly on the cash balance", () => {
    const usdtTxs = w.transactions.filter((t) => t.symbol === "USDT");
    const net = usdtTxs.reduce((s, t) => s + (t.direction === "in" ? t.amount : -t.amount), 0);
    expect(net).toBeCloseTo(w.usdc.value, 2);
    expect(usdtTxs.every((t) => t.tokenAddress === BSC.usdc.address)).toBe(true);
    const times = w.transactions.map((t) => t.timestamp ?? 0);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("links every receipt to BscScan", () => {
    for (const a of w.activity) {
      expect(a.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(txUrl(a.txHash, BSC)).toBe(`https://bscscan.com/tx/${a.txHash}`);
    }
    for (const t of w.transactions) expect(txUrl(t.hash, BSC)).toMatch(/^https:\/\/bscscan\.com\/tx\/0x[0-9a-f]{64}$/);
  });

  it("shows plans whose legs add up and name real tickers", () => {
    for (const a of w.activity) {
      expect(a.legs!.reduce((s, l) => s + l.usdcIn, 0)).toBeCloseTo(a.usdc, 6);
      expect(a.legCount).toBe(a.legs!.length);
      for (const l of a.legs!) {
        expect(assetBySymbol(BSC, l.symbol)).toBeDefined();
        expect(l.usdcIn).toBeGreaterThanOrEqual(BSC_MIN_LEG_USD);
      }
    }
  });

  it("has a small Venus savings balance and a rate", () => {
    expect(w.savings!.balanceUsd).toBeGreaterThan(0);
    expect(w.savings!.balanceUsd).toBeLessThan(100);
    expect(w.savings!.rate).toMatchObject({ available: true, apyDisplay: "4.20%" });
  });

  it("prices every listed asset, with the real share's price alongside each stock", () => {
    for (const a of BSC.assets.all) {
      const p = w.prices.prices[a.symbol];
      expect(p.priceUsd, a.symbol).toBeGreaterThan(0);
      if (a.tier === "stock") expect(p.marketPrice, a.symbol).toBeGreaterThan(0);
      expect(w.marketSummary.summary[a.symbol].spark.length).toBeGreaterThan(2);
    }
  });

  it("has a value line and positions that agree with the holdings", () => {
    const h = w.history("1M");
    expect(h.series.length).toBeGreaterThan(10);
    for (const row of w.portfolio.holdings.filter((x) => !x.venue || x.venue === x.asset.platform)) {
      const pos = h.positions.find((p) => p.symbol === row.asset.symbol);
      expect(pos, row.asset.symbol).toBeDefined();
    }
    const nvda = h.positions.find((p) => p.symbol === "NVDA")!;
    const held = w.portfolio.holdings.filter((x) => x.asset.symbol === "NVDA").reduce((s, x) => s + x.qty, 0);
    expect(nvda.qty).toBeCloseTo(held, 6);
    expect(nvda.lots.length).toBeGreaterThan(3);
  });

  it("never says fee, Basescan, Base or a real person", () => {
    const text = JSON.stringify({ a: w.activity, t: w.transactions.map((t) => t.counterparty), v: w.veraRecord }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/basescan|aUSDC/i);
  });
});

describe("a visitor's session", () => {
  const base = buildBscWorld({ nowMs: OPEN });
  const nvdaOndo = base.portfolio.holdings.find((h) => h.asset.symbol === "NVDA" && h.venue === "ondo")!;

  it("a buy takes cash and adds to the stock, from the issuer bought", () => {
    const w = buildBscWorld({
      nowMs: OPEN,
      fills: [{ kind: "trade", side: "buy", symbol: "NVDA", venue: "ondo", usd: 50, qty: 0.26, txHash: demoTxHash(1) }],
    });
    expect(w.usdc.value).toBeCloseTo(base.usdc.value - 50, 2);
    const row = w.portfolio.holdings.find((h) => h.asset.symbol === "NVDA" && h.venue === "ondo")!;
    expect(row.qty).toBeCloseTo(nvdaOndo.qty + 0.26, 6);
    expect(w.transactions[0].hash).toBe(demoTxHash(1));
    expect(w.history("1M").positions.find((p) => p.symbol === "NVDA")!.lots.length).toBe(base.history("1M").positions.find((p) => p.symbol === "NVDA")!.lots.length + 1);
  });

  it("a first buy of a new stock adds a row; selling it all removes the row", () => {
    const buy = buildBscWorld({ nowMs: OPEN, fills: [{ kind: "trade", side: "buy", symbol: "MSFT", venue: "bstock", usd: 30, qty: 0.07, txHash: demoTxHash(2) }] });
    expect(buy.portfolio.holdings.find((h) => h.asset.symbol === "MSFT")!.venue).toBe("bstock");
    const sold = buildBscWorld({
      nowMs: OPEN,
      fills: [
        { kind: "trade", side: "buy", symbol: "MSFT", venue: "bstock", usd: 30, qty: 0.07, txHash: demoTxHash(2) },
        { kind: "trade", side: "sell", symbol: "MSFT", venue: "bstock", usd: 30, qty: 0.07, txHash: demoTxHash(3) },
      ],
    });
    expect(sold.portfolio.holdings.find((h) => h.asset.symbol === "MSFT")).toBeUndefined();
    expect(sold.usdc.value).toBeCloseTo(base.usdc.value, 2);
  });

  it("a placed plan shows up as one plan in Activity, and in Vera's record", () => {
    const p = demoBscAllocate({ goal: "Grow $60", amountUsd: 60, rwa: base.rwa!, nowMs: OPEN });
    const fills = demoBscPlanFills(p, 60, base.rwa!, demoTxHash(4));
    const w = buildBscWorld({ nowMs: OPEN, fills });
    expect(w.activity).toHaveLength(base.activity.length + 1);
    expect(w.activity[0].txHash).toBe(demoTxHash(4));
    expect(w.activity[0].usdc).toBeCloseTo(60, 0);
    expect(w.veraRecord.executedCount).toBe(base.veraRecord.executedCount + 1);
    expect(w.usdc.value).toBeCloseTo(base.usdc.value - 60, 0);
  });

  it("a Savings move shifts dollars between cash and Savings", () => {
    const w = buildBscWorld({ nowMs: OPEN, fills: [{ kind: "save", usd: 25, txHash: demoTxHash(5) }] });
    expect(w.usdc.value).toBeCloseTo(base.usdc.value - 25, 2);
    expect(w.savings!.balanceUsd).toBeCloseTo(base.savings!.balanceUsd + 25, 2);
    const out = buildBscWorld({ nowMs: OPEN, fills: [{ kind: "save", usd: -base.savings!.balanceUsd, txHash: demoTxHash(6) }] });
    expect(out.savings!.balanceUsd).toBeCloseTo(0, 2);
  });

  it("selling more cash than exists never goes negative", () => {
    const w = buildBscWorld({ nowMs: OPEN, fills: [{ kind: "trade", side: "buy", symbol: "AAPL", usd: 999_999, qty: 1, txHash: demoTxHash(7) }] });
    expect(w.usdc.value).toBe(0);
  });
});

describe("world selection", () => {
  it("BNB Chain is the demo; Base keeps its own data and Mantle reads as Base", () => {
    expect(demoWorldFor("bsc", { nowMs: OPEN, fills: [] }).chain).toBe("bsc");
    expect(demoWorldFor("base", { nowMs: OPEN, fills: [] }).chain).toBe("base");
    expect(demoWorldFor("mantle", { nowMs: OPEN, fills: [] }).chain).toBe("base");
    expect(demoWorldFor("base", { nowMs: OPEN, fills: [] }).rwa).toBeNull();
  });

  it("in a closed market the demo account still holds what it holds", () => {
    const w = buildBscWorld({ nowMs: WEEKEND });
    expect(w.portfolio.holdings.length).toBe(BSC_HOLDING_SEEDS.length);
    expect(w.rwa!.tickers.every((t) => t.bestVenue === null)).toBe(true);
  });
});
