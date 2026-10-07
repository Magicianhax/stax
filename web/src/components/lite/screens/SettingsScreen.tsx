"use client";

// Settings — faithful re-skin of the design's Settings screen, wired to REAL
// state: profile identity from Privy + the smart-account address, Appearance from
// useTheme, and a real sign-out via useLogout.
//
// It also holds the "Vera" section that used to be a whole screen: who she is
// (her on-chain identity, linked to the IdentityRegistry) and her three headline
// numbers. Kept to one row plus one stat line — Settings is a list, not a landing
// page. What she has actually done lives on Activity.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrivy, useLogout } from "@privy-io/react-auth";
import { Icon, NetworkSwitch, Seal, StaxMark, VeraOrb, type IconName } from "@/components/design";
import { useTheme, type ColorMode } from "@/hooks/useTheme";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useAgentIdentity } from "@/hooks/useAgentIdentity";
import { useVeraRecord } from "@/hooks/useVeraRecord";
import { useHaptics, haptic } from "@/lib/haptics";
import { addressUrl, shortAddress, usd } from "@/lib/format";
import { siteUrl } from "@/lib/urls";
import { iconBtn, sectionLabel } from "./primitives";
import { useChainReady } from "../useChainReady";
import { useDemo, type DemoMarketMode } from "@/components/demo/DemoProvider";
import { DEMO_CHAIN_KEYS } from "@/lib/demo/world";

const DEMO_MARKETS: { mode: DemoMarketMode; label: string }[] = [
  { mode: "live", label: "Your clock" },
  { mode: "open", label: "Open" },
  { mode: "closed", label: "Closed" },
];

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on }: { on: boolean }) {
  // Presentational only: the whole Row is the switch (see Row's `switchOn`), so
  // the label and the track are one 44px target instead of a 50px sliver, and
  // nothing nests a button inside a button.
  return (
    <span
      aria-hidden
      style={{
        width: 50,
        height: 30,
        borderRadius: 99,
        flex: "none",
        padding: 3,
        background: on ? "var(--primary)" : "var(--surface-2)",
        boxShadow: on ? "none" : "inset 0 0 0 1px var(--line)",
        transition: "background .3s var(--ease-soft), box-shadow .3s var(--ease-soft)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          transform: on ? "translateX(20px)" : "translateX(0)",
          transition: "transform .26s var(--ease-soft)",
        }}
      />
    </span>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────
function Row({
  icon,
  title,
  sub,
  right,
  onClick,
  switchOn,
  borderTop,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  right?: ReactNode;
  onClick?: () => void;
  /** Renders the row AS a switch: the whole row toggles, not just the track. */
  switchOn?: boolean;
  borderTop?: boolean;
}) {
  // A row that does something is a <button>; a row that only displays is a <div>.
  // Switch rows are buttons too — their track is a plain span, so nothing nests.
  const isSwitch = switchOn !== undefined;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={onClick ? "row" : undefined}
      role={isSwitch ? "switch" : undefined}
      aria-checked={isSwitch ? switchOn : undefined}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 2px",
        textAlign: "left",
        borderTop: borderTop ? "1px solid var(--line-2)" : "none",
      }}
    >
      <span
        style={{
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
        <Icon name={icon} size={19} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </Tag>
  );
}

export function SettingsScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { logout } = useLogout();
  const { address } = useSmartAccount();
  const { colorMode, toggle } = useTheme();
  const { chain, ready, investable } = useChainReady();
  const demo = useDemo();
  const { on: hapticsOn, supported: hapticsSupported, toggle: toggleHaptics } = useHaptics();
  // Vera's identity + headline numbers (both REAL, from the chain).
  const { data: veraIdentity } = useAgentIdentity();
  const { data: veraRecord, isLoading: veraLoading } = useVeraRecord();
  const registryUrl =
    veraIdentity && chain.contracts.deployed ? addressUrl(veraIdentity.registry, chain) : undefined;
  const veraStats: { label: string; value: string; accent?: string }[] = [
    { label: "Plans built", value: (veraRecord?.totalRecommendations ?? 0).toLocaleString("en-US") },
    { label: "Invested", value: usd(veraRecord?.totalExecutedUsd ?? 0), accent: "var(--pos)" },
    { label: "Placed", value: (veraRecord?.executedCount ?? 0).toLocaleString("en-US") },
  ];

  // Identity — prefer a human handle, fall back to the smart-account address.
  const identity =
    user?.email?.address ??
    user?.google?.email ??
    user?.twitter?.username ??
    (address ? shortAddress(address) : "");

  const isAddress = identity.startsWith("0x");
  // Friendly name: email local-part (capitalised) or a sensible default.
  const localPart = identity.includes("@") ? identity.split("@")[0] : isAddress ? "" : identity;
  const name = localPart
    ? localPart.charAt(0).toUpperCase() + localPart.slice(1)
    : "Investor";

  // The Appearance row must describe what is on screen. The real app renders
  // useTheme's mode, but the demo pins `data-mode` on `.stax` regardless of the
  // stored preference, so read the rendered mode from the DOM and prefer it.
  const rootRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<ColorMode | null>(null);
  useEffect(() => {
    const m = rootRef.current?.closest(".stax")?.getAttribute("data-mode");
    setRendered(m === "light" || m === "dark" ? m : null);
  }, [colorMode]);
  const darkOn = (rendered ?? colorMode) === "dark";

  return (
    <div ref={rootRef} className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>
          Settings
        </h1>
      </div>

      {/* profile card */}
      <div className="anim-rise" style={{ padding: "18px 22px 0" }}>
        <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14 }}>
          <span
            aria-hidden
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--primary-soft)",
              boxShadow: "inset 0 0 0 1px var(--line-2)",
            }}
          >
            <StaxMark size={30} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>{name}</div>
            <div
              className="mono"
              style={{
                fontSize: 12.5,
                color: "var(--ink-2)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {identity || "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Vera — who she is and her three numbers. One row, one stat line, one
          sentence; her full history lives on Activity. */}
      <div style={{ padding: "24px 22px 0" }}>
        <div style={sectionLabel}>Vera</div>
        <div className="card" style={{ padding: "6px 16px" }}>
          {/* identity — links to the IdentityRegistry entry when the chain has one */}
          {(() => {
            const inner = (
              <>
                <VeraOrb size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Seal size={18} />
                    <span style={{ fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em" }}>
                      Verified agent
                    </span>
                    <span
                      className="serif tnum"
                      style={{ fontSize: 17, fontWeight: 600, color: "var(--primary)", lineHeight: 1 }}
                    >
                      №{veraIdentity ? veraIdentity.agentId.toString() : "1"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                    {veraIdentity && registryUrl ? (
                      <>
                        IdentityRegistry <span className="mono">{shortAddress(veraIdentity.registry)}</span>
                      </>
                    ) : (
                      "Registered on-chain"
                    )}
                  </div>
                </div>
                {registryUrl && <Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />}
              </>
            );
            const style = {
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "13px 2px",
              minHeight: 64,
              textAlign: "left" as const,
            };
            return registryUrl ? (
              <a
                href={registryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="row"
                style={style}
              >
                {inner}
              </a>
            ) : (
              <div style={style}>{inner}</div>
            );
          })()}

          {/* the three numbers, on one line */}
          <div style={{ display: "flex", textAlign: "center", padding: "12px 0", borderTop: "1px solid var(--line-2)" }}>
            {veraStats.map((s, i) => (
              <div key={s.label} style={{ flex: 1, borderRight: i < veraStats.length - 1 ? "1px solid var(--line-2)" : "none" }}>
                <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: s.accent ?? "var(--ink)" }}>
                  {!ready ? (
                    "—"
                  ) : veraLoading ? (
                    <span className="skeleton" style={{ display: "inline-block", width: 40, height: 18, borderRadius: 6 }} />
                  ) : (
                    s.value
                  )}
                </div>
                <div className="label-eyebrow" style={{ marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Only true on the executor path; BNB Chain plans go straight from your account, so
            nothing is signed or recorded by Vera there until the executor is switched on. */}
        {ready ? (
          <p style={{ margin: "10px 4px 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
            Every plan is signed and recorded on-chain, so this record can&apos;t be edited afterwards.
          </p>
        ) : investable ? (
          <p style={{ margin: "10px 4px 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
            On {chain.name}, Binance checks each trade before it&apos;s sent.
          </p>
        ) : null}
      </div>

      {/* Network — BNB Chain is the default; Base has gifts; Mantle keeps earlier investments. One
          segmented control, one sentence, no chain-picker jargon. */}
      <div style={{ padding: "24px 22px 0" }}>
        <div style={sectionLabel}>Network</div>
        <div className="card" style={{ padding: 16 }}>
          <NetworkSwitch keys={demo ? DEMO_CHAIN_KEYS : undefined} />
          <p style={{ margin: "12px 2px 0", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
            BNB Chain is the default, with stocks from bStock and Ondo. Base has gifts and your earlier Base investments. Mantle holds older ones.
            {!investable && (
              <>
                {" "}
                Investing on {chain.name} opens shortly; you can browse prices meanwhile.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Demo only: pin the US market open or shut, so both stories can be tried at any hour. */}
      {demo?.rwa && (
        <div style={{ padding: "24px 22px 0" }}>
          <div style={sectionLabel}>Demo market</div>
          <div className="card" style={{ padding: 16 }}>
            <div className="seg" role="radiogroup" aria-label="Demo market">
              <span
                className="seg-thumb"
                style={{
                  width: "calc((100% - 8px) / 3)",
                  left: 4,
                  transform: `translateX(calc(${DEMO_MARKETS.findIndex((m) => m.mode === demo.marketMode)} * 100%))`,
                }}
              />
              {DEMO_MARKETS.map((m) => (
                <button
                  key={m.mode}
                  role="radio"
                  aria-checked={m.mode === demo.marketMode}
                  onClick={() => {
                    haptic.select();
                    demo.setMarketMode(m.mode);
                  }}
                  className={`seg-item ${m.mode === demo.marketMode ? "is-on" : ""}`}
                  style={{ height: 44 }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p style={{ margin: "12px 2px 0", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>
              This demo uses no money and no login. “Your clock” follows the real US market hours where you are. Pick Open to buy a
              stock, or Closed to watch Vera refuse to buy one at a closed-market price.
            </p>
          </div>
        </div>
      )}

      {/* Appearance */}
      <div style={{ padding: "24px 22px 0" }}>
        <div style={sectionLabel}>
          Appearance
        </div>
        <div className="card" style={{ padding: "6px 16px" }}>
          <Row
            icon={darkOn ? "moon" : "sun"}
            title="Appearance"
            sub={darkOn ? "Dark" : "Light"}
            switchOn={darkOn}
            onClick={() => {
              haptic.select();
              toggle();
            }}
            right={<Toggle on={darkOn} />}
          />
          {hapticsSupported && (
            <Row
              icon="vibrate"
              title="Haptics"
              sub={hapticsOn ? "On" : "Off"}
              switchOn={hapticsOn}
              onClick={toggleHaptics}
              right={<Toggle on={hapticsOn} />}
              borderTop
            />
          )}
        </div>
      </div>

      {/* Account */}
      <div style={{ padding: "24px 22px 0" }}>
        <div style={sectionLabel}>
          Account
        </div>
        <div className="card" style={{ padding: "6px 16px" }}>
          <Row
            icon="wallet"
            title="Wallet"
            sub="Cash, holdings, add money & send"
            onClick={() => go("wallet")}
            right={<Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />}
          />
          <Row
            icon="spark"
            title="Autopilot"
            sub="Let Vera invest on a schedule"
            onClick={() => go("autopilot")}
            right={<Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
          <Row
            icon="receipt"
            title="Activity & receipts"
            sub="Your history and Vera's record"
            onClick={() => go("activity")}
            right={<Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
        </div>
      </div>

      {/* Support */}
      <div style={{ padding: "24px 22px 0" }}>
        <div style={sectionLabel}>
          Support
        </div>
        <div className="card" style={{ padding: "6px 16px" }}>
          <Row
            icon="info"
            title="Help & FAQ"
            sub="How Stax works, in plain words"
            onClick={() => go("help")}
            right={<Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />}
          />
          <Row
            icon="link"
            title="Follow @stax_market"
            sub="Updates and support on X"
            onClick={() => window.open("https://x.com/stax_market", "_blank", "noopener")}
            right={<Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
          <Row
            icon="lock"
            title="Privacy"
            onClick={() => window.open(siteUrl("/privacy"), "_blank", "noopener")}
            right={<Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
          <Row
            icon="signature"
            title="Terms"
            onClick={() => window.open(siteUrl("/terms"), "_blank", "noopener")}
            right={<Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
        </div>
      </div>

      {/* sign out */}
      <div style={{ padding: "26px 22px 0" }}>
        <button
          className="btn btn-ghost btn-block tap"
          onClick={() => logout()}
          style={{ color: "var(--neg)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
