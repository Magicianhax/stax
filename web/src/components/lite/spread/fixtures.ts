// Fixture data for previewing IssuerBoard and PriceVsRealShare without a live catalog or Redis
// history — not imported by app code, only by a throwaway preview route during development.
import { issuerDiffSentence, rankIssuerBoard, type SpreadBoardRow, type SpreadPoint } from "@/lib/spread";

const RAW_BOARD = [
  { ticker: "NVDA", venues: [{ platform: "bstock" as const, tokenPrice: 181.2, buyable: true }, { platform: "ondo" as const, tokenPrice: 180.8, buyable: true }] },
  { ticker: "TSLA", venues: [{ platform: "bstock" as const, tokenPrice: 256.4, buyable: false }, { platform: "ondo" as const, tokenPrice: 254.1, buyable: true }] },
  { ticker: "AAPL", venues: [{ platform: "bstock" as const, tokenPrice: 231.9, buyable: true }, { platform: "ondo" as const, tokenPrice: 232.55, buyable: true }] },
  { ticker: "MSFT", venues: [{ platform: "bstock" as const, tokenPrice: 421.0, buyable: true }, { platform: "ondo" as const, tokenPrice: 420.85, buyable: true }] },
];

export const FIXTURE_BOARD: SpreadBoardRow[] = rankIssuerBoard(RAW_BOARD).map((row) => ({
  ...row,
  sentence: issuerDiffSentence(row),
}));

function series(baseToken: number, baseRef: number, hours: number, drift: number): SpreadPoint[] {
  const now = Date.UTC(2026, 8, 24, 12, 0, 0);
  const points: SpreadPoint[] = [];
  for (let i = hours; i >= 0; i--) {
    const t = now - i * 60 * 60 * 1000;
    const wave = Math.sin(i / 4) * drift;
    const tokenPrice = Number((baseToken + wave + (hours - i) * 0.02).toFixed(2));
    const referencePrice = Number((baseRef + (hours - i) * 0.015).toFixed(2));
    const gapPct = ((tokenPrice - referencePrice) / referencePrice) * 100;
    points.push({
      t,
      tokenPrice,
      referencePrice,
      gapPct,
      buyable: i % 6 !== 0,
      state: i % 6 === 0 ? "closed" : "open",
    });
  }
  return points;
}

export const FIXTURE_HISTORY: SpreadPoint[] = series(180, 179.5, 48, 1.4);
