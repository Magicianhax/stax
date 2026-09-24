"use client";

// IssuerBoardScreen — "Which is cheaper?": the whole bStock-vs-Ondo board in one place, reached
// from a card at the top of Market and a Hub row (brief idea 6, "a bStock-vs-Ondo board"). Data
// comes from GET /api/rwa/spread?chain=bsc (useSpreadBoard); the ranking, the sentence and which
// issuer is cheaper are all lib/spread.ts's job (the `spread` stream) — this screen only lays out
// loading/error/empty and opens the tapped ticker with the cheaper issuer already chosen, so a
// viewer never has to make the same "which one" decision twice.
import { Icon, SectionTitle } from "@/components/design";
import { Reveal } from "@/components/motion";
import { useSpreadBoard } from "@/hooks/useSpread";
import { IssuerBoard } from "@/components/lite/spread/IssuerBoard";
import { boardRowTargetVenue } from "@/lib/issuerBoardNav";
import { iconBtn, Spinner } from "./primitives";

export function IssuerBoardScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { data, isLoading, isError, refetch } = useSpreadBoard();

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>Which is cheaper?</h1>
      </div>

      <Reveal style={{ padding: "10px 22px 0" }}>
        <p className="body" style={{ margin: 0, maxWidth: 340 }}>
          Some stocks here have two versions — one from bStock, one from Ondo. Same company, two
          prices. This list shows which one costs less right now, so you know which to buy.
        </p>
      </Reveal>

      <div style={{ padding: "20px 22px 0" }}>
        {isLoading ? (
          <div className="card" style={{ padding: "28px 18px", display: "flex", justifyContent: "center" }}>
            <Spinner />
          </div>
        ) : isError ? (
          <div className="card" style={{ padding: "22px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Couldn&apos;t load this</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Something went wrong reaching the price feed.
            </div>
            <button className="btn btn-ghost tap" style={{ marginTop: 14, minHeight: 44 }} onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <SectionTitle>Same stock, two prices</SectionTitle>
            <Reveal>
              <IssuerBoard
                rows={data?.board ?? []}
                onSelect={(ticker) => {
                  // Buyable-aware: a plain "cheapest price" pick can be a paused issuer, which
                  // would land the viewer on a screen contradicting the row they just tapped.
                  const venue = boardRowTargetVenue(ticker, data?.board ?? [], data?.tickers ?? []);
                  go("asset", { symbol: ticker, venue });
                }}
              />
            </Reveal>
          </>
        )}
      </div>
    </div>
  );
}
