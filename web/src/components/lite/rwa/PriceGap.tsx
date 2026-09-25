"use client";

// PriceGap — what the CHOSEN issuer's token costs against the real share, as a sentence: "You pay
// 0.40% more than the real share ($180.70)". Design critique P0 #3: the old "+0.40% vs NVDA" read
// as a price change (a signed percent next to a ticker is exactly what a day's gain/loss looks
// like everywhere else in this app), and it always led with whichever venue happened to be
// first in the list, not the one the person is actually about to buy from. `lib/plainCopy.ts`'s
// `gapSentence` is the one place that wording lives, so this and VenuePicker's per-row `gapWords`
// never drift apart on the 0.05% "same price" threshold.
import type { CSSProperties } from "react";
import type { VenueView } from "@/lib/rwa";
import { gapSentence } from "@/lib/plainCopy";

export interface PriceGapProps {
  /** The venue the buy will actually use — never "whichever is first" (design critique P0 #3). */
  venue: VenueView | undefined;
  style?: CSSProperties;
}

export function PriceGap({ venue, style }: PriceGapProps) {
  if (!venue || venue.gapPct === null) return null;
  const text = gapSentence(venue.gapPct, venue.referencePrice);
  if (!text) return null;

  return (
    <span className="tnum" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", ...style }}>
      {text}
    </span>
  );
}
