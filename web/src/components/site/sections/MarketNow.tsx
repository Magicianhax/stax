"use client";

// The live US-market line under the hero sentence: the page's one piece of
// proof for "the broker that knows the market is closed", in the visitor's
// own time. Same clock and formatter as the app's Market header
// (lib/site/landing `marketNow`). Rendered only after mount (the server has no
// idea of the visitor's time zone); until then the line holds its height so
// nothing below it moves. Re-reads the clock every 30 seconds.
import { useEffect, useState } from "react";
import { marketNow, type MarketNow } from "@/lib/site/landing";
import s from "./MarketNow.module.css";

const TICK_MS = 30_000;

export function MarketNowLine({ className }: { className?: string }) {
  const [now, setNow] = useState<MarketNow | null>(null);
  useEffect(() => {
    const read = () => setNow(marketNow(Date.now()));
    read();
    const id = setInterval(read, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <p
      className={`${s.line}${className ? ` ${className}` : ""}`}
      data-open={now?.open ? "1" : undefined}
      data-ready={now ? "1" : undefined}
      aria-live="polite"
    >
      <span className={s.dot} aria-hidden="true" />
      <span>{now?.text ?? "The US market is open"}</span>
    </p>
  );
}
