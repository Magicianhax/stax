"use client";

// Settings — faithful re-skin of the design's Settings screen, wired to REAL
// state: profile identity from Privy + the smart-account address, Appearance from
// useTheme, and a real sign-out via useLogout.
import type { CSSProperties, ReactNode } from "react";
import { usePrivy, useLogout } from "@privy-io/react-auth";
import { Icon, type IconName } from "@/components/design";
import { useTheme } from "@/hooks/useTheme";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useHaptics, haptic } from "@/lib/haptics";
import { shortAddress } from "@/lib/format";
import { iconBtn } from "./primitives";

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
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
    </button>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────
function Row({
  icon,
  title,
  sub,
  right,
  onClick,
  borderTop,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  right?: ReactNode;
  onClick?: () => void;
  borderTop?: boolean;
}) {
  // Rows that *are* a control render a <button>. Rows that only host a control
  // (e.g. the Appearance toggle) must NOT be a button — a <button> inside a
  // <button> is invalid HTML and triggers a hydration error. Render a <div>.
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={onClick ? "row" : undefined}
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

// Quiet sentence-case section label — NOT an uppercase tracked eyebrow (that
// reads as AI section-scaffolding when stacked on every group).
const sectionLabel: CSSProperties = {
  padding: "0 4px 9px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-.005em",
  color: "var(--ink-2)",
};

export function SettingsScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { user } = usePrivy();
  const { logout } = useLogout();
  const { address } = useSmartAccount();
  const { colorMode, toggle } = useTheme();
  const { on: hapticsOn, supported: hapticsSupported, toggle: toggleHaptics } = useHaptics();

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
  const initial = (name[0] ?? "I").toUpperCase();

  const darkOn = colorMode === "dark";

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
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
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 24,
            }}
          >
            {initial}
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
            right={
              <Toggle
                on={darkOn}
                onChange={() => {
                  haptic.select();
                  toggle();
                }}
                label="Dark appearance"
              />
            }
          />
          {hapticsSupported && (
            <Row
              icon="vibrate"
              title="Haptics"
              sub={hapticsOn ? "On" : "Off"}
              right={<Toggle on={hapticsOn} onChange={toggleHaptics} label="Haptic feedback" />}
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
            sub="Cash, holdings, send & receive"
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
            icon="shield"
            title="Vera's track record"
            onClick={() => go("vera")}
            right={<Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />}
            borderTop
          />
          <Row
            icon="receipt"
            title="Activity & receipts"
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
