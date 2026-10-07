"use client";

// Invest — the centre tab. A menu, not a landing page: one gift banner and four
// one-line rows, each opening its own screen. Everything Vera can do is reachable
// from here, and nothing here explains itself at length — the screens do that.
//
// This replaces the old Vera screen as a destination. Her identity and record
// moved to Settings (who she is) and Activity (what she has done).
import { Icon, VeraOrb, type IconName } from "@/components/design";
import { Reveal } from "@/components/motion";
import { useGifts, useGiftsEnabled } from "@/hooks/useGifts";
import { useChainReady } from "../useChainReady";

interface HubRow {
  id: string;
  icon: IconName;
  title: string;
  hint: string;
  onClick: () => void;
  /** Claimable-gift count, drawn as a badge on the icon. */
  badge?: number;
}

export function HubScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  // `investable`, not `ready`: BNB Chain invests straight from the account without an executor.
  const { chain, investable } = useChainReady();
  const giftsOn = useGiftsEnabled();
  const { claimableCount } = useGifts();

  const rows: HubRow[] = [
    {
      id: "goal",
      icon: "orbit",
      title: "Build a plan",
      hint: investable ? "Tell Vera a goal, get a plan in seconds" : `Opening shortly on ${chain.name}`,
      onClick: () => go("goal"),
    },
    {
      id: "autopilot",
      icon: "spark",
      title: "Autopilot",
      hint: "Invest on a schedule, within your limits",
      onClick: () => go("autopilot"),
    },
    ...(giftsOn
      ? [
          {
            id: "gifts",
            icon: "receipt" as IconName,
            title: "Your gifts",
            hint:
              claimableCount > 0
                ? `${claimableCount === 1 ? "One is" : `${claimableCount} are`} ready to claim`
                : "The ones you sent and the ones waiting",
            onClick: () => go("gifts"),
            badge: claimableCount,
          },
        ]
      : []),
    {
      id: "baskets",
      icon: "grid",
      title: "Baskets",
      hint: "Ready-made mixes, one tap each",
      onClick: () => go("baskets"),
    },
    // BSC only: some stocks here have two versions (bStock and Ondo). Off BSC there's only ever
    // one issuer, so the board would have nothing to compare.
    ...(chain.key === "bsc"
      ? [
          {
            id: "issuers",
            icon: "trend" as IconName,
            title: "Which is cheaper?",
            hint: "Same stock, two prices — see which one to buy",
            onClick: () => go("issuers"),
          },
        ]
      : []),
  ];

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 110 }}>
      {/* header */}
      <div style={{ padding: "10px 22px 0" }}>
        <div className="caption" style={{ fontWeight: 500 }}>With Vera</div>
        <h1 className="serif" style={{ margin: 0, fontSize: 26, letterSpacing: "-.01em" }}>
          Invest
        </h1>
      </div>

      <Reveal style={{ padding: "18px 22px 0" }}>
        {/* gift banner — the one thing on this screen that gets colour */}
        {giftsOn && (
          <button
            onClick={() => go("gift")}
            className="card tap"
            style={{
              width: "100%",
              textAlign: "left",
              padding: 18,
              display: "flex",
              gap: 14,
              alignItems: "center",
              background: "var(--vera-grad)",
              color: "var(--primary-ink)",
              boxShadow: "var(--shadow-lg)",
              position: "relative",
              overflow: "hidden",
              minHeight: 44,
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "radial-gradient(120% 140% at 92% -20%, rgba(255,255,255,.28), transparent 55%)",
                pointerEvents: "none",
              }}
            />
            <span
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                flex: "none",
                display: "grid",
                placeItems: "center",
                background: "rgba(255,255,255,0.22)",
                position: "relative",
              }}
            >
              <Icon name="gift" size={22} stroke={2.2} />
            </span>
            <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em" }}>
                Give a basket
              </div>
              <div style={{ fontSize: 13.5, opacity: 0.85, marginTop: 1 }}>
                Invest for someone, held until a day you pick.
              </div>
            </div>
            <Icon name="arrowUR" size={22} stroke={2.2} style={{ position: "relative", flex: "none" }} />
          </button>
        )}

        {/* the menu */}
        <div className="card" style={{ padding: "4px 16px", marginTop: giftsOn ? 16 : 0 }}>
          {rows.map((r, i) => (
            <button
              key={r.id}
              className="row"
              onClick={r.onClick}
              aria-label={r.badge ? `${r.title}, ${r.badge} ready to claim` : r.title}
              style={{
                padding: "13px 0",
                minHeight: 64,
                borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : "none",
              }}
            >
              <span
                style={{
                  position: "relative",
                  width: 38,
                  height: 38,
                  borderRadius: 11,
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                  background: "var(--surface-2)",
                  color: "var(--ink-2)",
                }}
              >
                {r.id === "goal" ? <VeraOrb size={24} /> : <Icon name={r.icon} size={19} stroke={2} />}
                {r.badge ? (
                  <span
                    className="tnum"
                    style={{
                      position: "absolute",
                      top: -5,
                      right: -5,
                      minWidth: 20,
                      height: 20,
                      padding: "0 5px",
                      borderRadius: 99,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11.5,
                      fontWeight: 700,
                      background: "var(--primary)",
                      color: "var(--primary-ink)",
                      boxShadow: "0 0 0 2px var(--surface)",
                    }}
                  >
                    {r.badge}
                  </span>
                ) : null}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>{r.title}</div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-2)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.hint}
                </div>
              </div>
              <Icon name="chevR" size={18} style={{ color: "var(--ink-3)", flex: "none" }} />
            </button>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
