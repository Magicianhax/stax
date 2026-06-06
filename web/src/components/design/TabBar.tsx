"use client";

// Stax bottom tab bar — ported from the design handoff (components.jsx).
// Frosted bar with a raised center "Invest" action. Tab set depends on `pro`.
import { Icon, type IconName } from "./Icon";

export type TabId = "home" | "portfolio" | "market" | "invest" | "vera";

interface Tab {
  id: TabId;
  icon: IconName;
  label: string;
  center?: boolean;
}

export interface TabBarProps {
  active: TabId;
  onNav: (id: TabId) => void;
  pro?: boolean;
}

export function TabBar({ active, onNav, pro = false }: TabBarProps) {
  const ordered: Tab[] = pro
    ? [
        { id: "home", icon: "home", label: "Home" },
        { id: "market", icon: "grid", label: "Market" },
        { id: "invest", icon: "spark", label: "Invest", center: true },
        { id: "portfolio", icon: "trend", label: "Owned" },
        { id: "vera", icon: "shieldPlain", label: "Vera" },
      ]
    : [
        { id: "home", icon: "home", label: "Home" },
        { id: "portfolio", icon: "trend", label: "Owned" },
        { id: "invest", icon: "spark", label: "Invest", center: true },
        { id: "vera", icon: "shieldPlain", label: "Vera" },
      ];

  return (
    <div
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: "calc(10px + env(safe-area-inset-bottom))",
        zIndex: 40,
        padding: "9px 12px",
        borderRadius: 99,
        background: "var(--glass)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: "1px solid var(--glass-stroke)",
        boxShadow: "var(--glass-hi), 0 16px 38px -12px rgba(0, 0, 0, 0.5)",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
      }}
    >
      {ordered.map((t) => {
        const on = active === t.id;
        if (t.center) {
          return (
            <button
              key={t.id}
              onClick={() => onNav(t.id)}
              aria-label={t.label}
              className={`tab-fab${on ? " is-active" : ""}`}
              style={{
                width: 56,
                height: 56,
                borderRadius: 20,
                marginTop: -26,
                background: "var(--hero-grad)",
                color: "var(--primary-ink)",
                display: "grid",
                placeItems: "center",
                boxShadow: "var(--shadow-lg)",
              }}
            >
              <Icon name="spark" size={26} stroke={2} />
            </button>
          );
        }
        return (
          <button
            key={t.id}
            onClick={() => onNav(t.id)}
            className="tap"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 4,
              color: on ? "var(--ink)" : "var(--ink-3)",
              flex: 1,
              minWidth: 0,
              transition: "color .2s var(--ease-out)",
            }}
          >
            <Icon name={t.icon} size={23} stroke={on ? 2.2 : 1.8} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500 }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
