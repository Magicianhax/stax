"use client";

// Your gifts — two short lists: the ones you sent and the ones waiting for you.
// A row opens the gift in a sheet, where the note, the split, and the single
// available action live. Reached from the Invest hub; `focus` opens one straight away
// (that's how a `?gift=<id>` link lands).
import { useState } from "react";
import { Icon, SectionTitle } from "@/components/design";
import { Reveal } from "@/components/motion";
import { useGifts } from "@/hooks/useGifts";
import { iconBtn } from "./primitives";
import { GiftRow } from "../gift/giftPrimitives";
import { GiftDetailSheet } from "../gift/GiftDetailSheet";
import type { Gift } from "../gift/types";

export function GiftViewScreen({
  go,
  focus,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
  /** Open this gift's sheet on arrival (a shared link). */
  focus?: string;
}) {
  const { sent, received, claimableCount, loading, error, byId } = useGifts();
  const [openId, setOpenId] = useState<string | null>(null);
  // A link that named a gift opens it as soon as the lists have it — derived,
  // not an effect, so there's no render just to set state. Closing the sheet
  // retires the link's claim on it for good.
  const [linkSpent, setLinkSpent] = useState(false);
  const shownId = openId ?? (linkSpent ? null : (focus ?? null));
  const open: Gift | null = shownId ? (byId(shownId) ?? null) : null;
  const closeSheet = () => {
    setOpenId(null);
    setLinkSpent(true);
  };
  const empty = !loading && !error && sent.length === 0 && received.length === 0;

  const section = (title: string, rows: Gift[], hint?: string) =>
    rows.length === 0 ? null : (
      <div style={{ padding: "20px 22px 0" }}>
        <SectionTitle>{title}</SectionTitle>
        {hint && (
          <p style={{ margin: "-4px 0 10px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>{hint}</p>
        )}
        <Reveal className="card" style={{ padding: "4px 16px" }}>
          {rows.map((g, i) => (
            <GiftRow key={g.id} gift={g} last={i === rows.length - 1} onClick={() => setOpenId(g.id)} />
          ))}
        </Reveal>
      </div>
    );

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, marginLeft: 4, fontSize: 22, letterSpacing: "-.01em" }}>
          Gifts
        </h1>
      </div>

      {claimableCount > 0 && (
        <Reveal style={{ padding: "14px 22px 0" }}>
          <div
            role="status"
            className="card"
            style={{ padding: 16, background: "var(--primary-soft)", color: "var(--primary)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {claimableCount === 1 ? "A gift is ready for you" : `${claimableCount} gifts are ready for you`}
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
              Open it below and the holdings move into your account.
            </p>
          </div>
        </Reveal>
      )}

      {loading && (
        <div style={{ padding: "20px 22px 0" }}>
          <div className="card" style={{ padding: "4px 16px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "15px 0",
                  borderBottom: i < 2 ? "1px solid var(--line-2)" : "none",
                }}
              >
                <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 11, flex: "none" }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton" style={{ width: "52%", height: 13, borderRadius: 6 }} />
                  <div className="skeleton" style={{ width: "34%", height: 11, borderRadius: 6, marginTop: 7 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ padding: "20px 22px 0" }}>
          <div className="card" role="status" style={{ padding: "22px 18px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Couldn&apos;t load your gifts</div>
            <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{error}</p>
          </div>
        </div>
      )}

      {section("For you", received, "Sent to you by someone else.")}
      {section("You sent", sent)}

      {empty && (
        <Reveal style={{ padding: "22px 22px 0" }}>
          <div className="card" style={{ padding: "28px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-.01em" }}>No gifts yet</div>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>
              A gift puts money into a basket for someone else, invested straight away and held safely until a day
              you choose.
            </p>
            <button
              className="btn btn-primary tap"
              style={{ marginTop: 16, minHeight: 46, paddingInline: 20 }}
              onClick={() => go("gift")}
            >
              Gift a basket
            </button>
          </div>
        </Reveal>
      )}

      {!empty && !loading && (
        <div style={{ padding: "20px 22px 0" }}>
          <button className="btn btn-ghost btn-block tap" style={{ minHeight: 48 }} onClick={() => go("gift")}>
            <Icon name="gift" size={17} /> Gift a basket
          </button>
        </div>
      )}

      <GiftDetailSheet gift={open} onClose={closeSheet} />
    </div>
  );
}
