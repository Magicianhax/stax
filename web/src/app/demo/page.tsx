import type { Metadata } from "next";
import { DemoMount } from "@/components/demo/DemoMount";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Try Stax on BNB Chain with demo data — no login, no money. See how Vera plans from the stocks that are open to buy right now.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Stax · Live demo",
    description:
      "Try Stax on BNB Chain with demo data — no login, no money. See how Vera plans from what's open right now.",
    url: "/demo",
  },
};

// Auth-free, demo-data preview of the real Stax app — embedded by the marketing
// site phones and viewable directly at /demo. `?play=invest|vera` auto-plays a
// scripted walkthrough; no param = fully interactive. `?mode=light` flips theme.
// It runs on BNB Chain; `?market=open|closed` pins the US market open or shut (default: the
// viewer's own clock), so both the "buy now" and the "market is closed" stories can be tried.
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ play?: string; mode?: string; market?: string }>;
}) {
  const sp = await searchParams;
  const play = sp.play === "invest" || sp.play === "vera" ? sp.play : null;
  const mode = sp.mode === "light" ? "light" : "dark";
  const market = sp.market === "open" || sp.market === "closed" ? sp.market : "live";
  return <DemoMount play={play} mode={mode} market={market} />;
}
