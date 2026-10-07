"use client";

// Success — the Vera invest just filled (screens_invest.jsx · Success) wired to
// the REAL invest result (InvestSuccess: txHash, holdings, amountUsd). Burst,
// the consequence ("Cash $240.55 → $140.55"), what you now hold (rows flash
// once), and the on-chain record. Done hands back to LiteApp (Home + toast).
import { useEffect } from "react";
import { SectionTitle, HoldingRow, Icon } from "@/components/design";
import { Burst, DrawCheck, Money, Reveal } from "@/components/motion";
import { toTile, catFor } from "@/lib/displayAssets";
import { YieldTag } from "./primitives";
import { assetBySymbol } from "@/lib/chains";
import { usd, txUrl } from "@/lib/format";
import { useChain } from "@/lib/chains/active";
import { haptic } from "@/lib/haptics";
import type { InvestSuccess } from "@/lib/invest-types";

export function SuccessScreen({
  success,
  prevCash,
  onDone,
}: {
  success: InvestSuccess;
  /** Cash before the invest, for the consequence line. */
  prevCash?: number;
  onDone: () => void;
}) {
  const { amountUsd, holdings, txHash } = success;
  const chain = useChain();
  // Consequence line only when the numbers add up (demo data can invest more
  // than the demo cash balance; real invests never can).
  const newCash = prevCash !== undefined && prevCash >= amountUsd ? prevCash - amountUsd : undefined;

  // Celebrate the moment with a short success buzz (once, on arrival).
  useEffect(() => {
    haptic.success();
  }, []);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <Burst />

      <div style={{ padding: "30px 22px 0", textAlign: "center" }}>
        <div style={{ position: "relative", width: 92, height: 92, margin: "10px auto 22px" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: -16,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent), transparent 70%)",
              filter: "blur(14px)",
              animation: "softBurst 1.2s var(--ease-out) both",
            }}
          />
          <DrawCheck size={92} style={{ position: "relative" }} />
        </div>
        <Reveal delay={0.2}>
          <h1 className="serif" style={{ fontSize: 32, margin: "0 0 8px", letterSpacing: "-.01em" }}>
            You&apos;re invested.
          </h1>
          <p style={{ fontSize: 16, color: "var(--ink-2)", margin: 0 }}>
            <b className="tnum">{usd(amountUsd)}</b> is now working across {holdings.length}{" "}
            {holdings.length === 1 ? "holding" : "holdings"}.
          </p>
          {prevCash !== undefined && newCash !== undefined && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 12,
                padding: "6px 12px",
                borderRadius: 99,
                background: "var(--surface-2)",
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--ink-2)",
              }}
            >
              Cash <Money value={prevCash} />
              <Icon name="arrowDR" size={14} style={{ color: "var(--ink-3)", transform: "rotate(-45deg)" }} />
              <Money value={newCash} prev={prevCash} style={{ color: "var(--ink)" }} />
            </div>
          )}
        </Reveal>
      </div>

      {/* what you now hold — each row flashes once as it enters view */}
      <Reveal delay={0.3} style={{ padding: "26px 22px 0" }}>
        <SectionTitle>You now hold</SectionTitle>
        <Reveal delay={0.4} className="card" style={{ padding: "4px 14px" }}>
          {holdings.map((h, i) => (
            <div key={h.symbol} style={{ borderBottom: i < holdings.length - 1 ? "1px solid var(--line-2)" : "none" }}>
              <HoldingRow
                asset={toTile(h.symbol, h.name)}
                sub={assetBySymbol(chain, h.symbol)?.tier === "safe" ? <YieldTag symbol={h.symbol} /> : catFor(h.symbol, h.name)}
                showSpark={false}
                value={usd(h.amountUsd)}
                change={{ label: `${h.weightPct}% of the plan` }}
                flashKey={`${h.symbol}:${txHash}`}
              />
            </div>
          ))}
        </Reveal>
      </Reveal>

      {/* verified on-chain — the trust moment: Vera's risk call was signed +
          checked by the InferenceVerifier contract before any money moved */}
      <Reveal delay={0.5} style={{ padding: "18px 22px 0" }}>
        {success.verification ? (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
              <span
                style={{ width: 36, height: 36, borderRadius: 11, background: "var(--primary-soft)", display: "grid", placeItems: "center", color: "var(--primary)", flex: "none" }}
              >
                <Icon name="shield" size={20} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-.01em" }}>Verified on-chain</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>Provable, not just promised.</div>
              </div>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 99, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 12, fontWeight: 700, flex: "none" }}
              >
                <Icon name="signature" size={13} stroke={2.4} /> Signed
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
              Vera assessed this plan at{" "}
              <b style={{ color: "var(--ink)" }}>{Math.round(success.verification.riskScore / 100)}% risk</b>, within the{" "}
              <b style={{ color: "var(--ink)" }}>{Math.round(success.verification.maxRisk / 100)}%</b> ceiling she committed to.
              She signed that assessment, and the on-chain verifier checked it{" "}
              <b style={{ color: "var(--ink)" }}>before any money moved</b>.
            </p>

            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}
            >
              <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                sig {success.verification.signature.slice(0, 8)}…{success.verification.signature.slice(-6)}
              </span>
              <a
                href={txUrl(txHash, chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="tap"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
              >
                View on {chain.explorer.name} <Icon name="arrowUR" size={14} />
              </a>
            </div>
          </div>
        ) : (
          <a
            href={txUrl(txHash, chain)}
            target="_blank"
            rel="noopener noreferrer"
            className="card tap"
            style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: "var(--accent-soft)", textDecoration: "none", color: "inherit" }}
          >
            <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface)", display: "grid", placeItems: "center", color: "var(--accent)", flex: "none" }}>
              <Icon name="shield" size={22} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{chain.contracts.deployed ? "Vera recorded this plan" : `Your plan is on ${chain.name}`}</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
                View the receipt on {chain.explorer.name}
              </div>
            </div>
            <Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)" }} />
          </a>
        )}
      </Reveal>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "22px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) calc(100% - 22px), transparent)",
        }}
      >
        <button className="btn btn-primary btn-block btn-lg tap" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
