"use client";

// Baskets — ready-made mixes you can invest in with one tap. Two groups: Yours
// (saved from a Vera plan or a shared link) and Made by Stax (curated in code,
// filtered to what is fully investable on the active chain). Every tile leads to
// BasketDetail, where Invest hands a basketToAllocation() plan to PlanScreen.
import { Icon, SectionTitle } from "@/components/design";
import { useBaskets } from "@/hooks/useBaskets";
import { useChain } from "@/lib/chains/active";
import { iconBtn } from "./primitives";
import { BasketTile } from "./basketPrimitives";

export function BasketsScreen({
  go,
}: {
  go: (screen: string | number, params?: Record<string, unknown>) => void;
}) {
  const chain = useChain();
  const { curated, mine } = useBaskets();

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
      </div>

      <div className="anim-rise" style={{ padding: "16px 22px 0" }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 32, letterSpacing: "-.015em" }}>Baskets</h1>
        <p className="body" style={{ margin: "8px 0 0", maxWidth: 320 }}>
          Ready-made mixes you can invest in with one tap. Vera still checks the risk before anything is placed.
        </p>
      </div>

      {/* Yours */}
      <div style={{ padding: "24px 22px 0" }}>
        <SectionTitle>Yours</SectionTitle>
        {mine.length === 0 ? (
          <div className="card" style={{ padding: "22px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing saved yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Save a plan from Vera or open a link a friend shared, and it will show up here.
            </div>
            <button
              className="btn btn-ghost tap"
              onClick={() => go("goal")}
              style={{ marginTop: 14, minHeight: 44 }}
            >
              Ask Vera for a plan
            </button>
          </div>
        ) : (
          <div className="stagger">
            {mine.map((b) => (
              <BasketTile key={b.id} basket={b} onClick={() => go("basket", { id: b.id })} />
            ))}
          </div>
        )}
      </div>

      {/* Made by Stax */}
      <div style={{ padding: "18px 22px 0" }}>
        <SectionTitle>Made by Stax</SectionTitle>
        {curated.length === 0 ? (
          <div className="card" style={{ padding: "22px 18px", textAlign: "center", color: "var(--ink-2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Nothing on {chain.name} yet</div>
            <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.5 }}>
              Baskets appear here once enough companies are buyable on {chain.name}.
            </div>
          </div>
        ) : (
          <div className="stagger">
            {curated.map((b) => (
              <BasketTile key={b.id} basket={b} onClick={() => go("basket", { id: b.id })} />
            ))}
          </div>
        )}
      </div>

      <p style={{ fontSize: 12.5, color: "var(--ink-2)", padding: "10px 26px 0", lineHeight: 1.5, textAlign: "center" }}>
        Past returns don&apos;t promise future ones. Stocks can go down too.
      </p>
    </div>
  );
}
