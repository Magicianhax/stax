"use client";

// The Home hero invite. One card in the same frame, cross-fading between two
// messages every few seconds: invest with Vera, and gift a basket. Gifting only
// joins the rotation once the contract is live on this chain, so a single-slide
// banner is the normal case, not a special one.
//
// It pauses while the tab is hidden and while a pointer rests on it, and it
// respects reduced motion by holding the first slide and showing dots that still
// let someone move between them. Every slide is a real button, so nothing here
// is decoration a screen reader has to guess at.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, VeraOrb } from "@/components/design";
import { useGiftsEnabled } from "@/hooks/useGifts";
import { useChain } from "@/lib/chains/active";
import { useChainReady } from "./useChainReady";
import { haptic } from "@/lib/haptics";
import s from "./HomeBanners.module.css";

const ROTATE_MS = 6000;

interface Slide {
  id: string;
  title: string;
  body: string;
  art: React.ReactNode;
  onOpen: () => void;
}

export function HomeBanners({ go }: { go: (screen: string, params?: Record<string, unknown>) => void }) {
  const chain = useChain();
  const { ready } = useChainReady();
  const giftsOn = useGiftsEnabled();

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [
      {
        id: "vera",
        title: "Invest with Vera",
        body: ready
          ? "Tell me a goal, and I’ll build the plan."
          : `Opening shortly on ${chain.name}. Browse prices meanwhile.`,
        art: <VeraOrb size={50} pulse />,
        onOpen: () => go("goal"),
      },
    ];
    if (giftsOn) {
      out.push({
        id: "gift",
        title: "Give a basket",
        body: "Invest for someone else, held until a day you pick.",
        art: (
          <span className={s.giftArt} aria-hidden>
            <Icon name="send" size={24} stroke={2.1} />
          </span>
        ),
        onOpen: () => go("gift"),
      });
    }
    return out;
  }, [chain.name, giftsOn, go, ready]);

  const [rawIndex, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  // Derive rather than correct in an effect: if the slide set shrinks (gifting
  // switched off mid-session) the index simply wraps on the next render.
  const i = count ? rawIndex % count : 0;

  useEffect(() => {
    if (count < 2 || paused) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") setI((prev) => (prev + 1) % count);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  // Restart the fill animation on every change, including a manual dot tap.
  const barRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }, [i]);

  return (
    <div style={{ padding: "16px 22px 4px" }}>
      <div
        className={s.frame}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
      >
        {slides.map((slide, idx) => (
          <button
            key={slide.id}
            onClick={() => {
              haptic.light();
              slide.onOpen();
            }}
            className={`card tap ${s.slide}`}
            aria-hidden={idx !== i}
            tabIndex={idx === i ? 0 : -1}
            data-on={idx === i ? "true" : "false"}
            // Inline, not in the module: the global `.card` rule sets its own
            // background and wins on source order, which silently flattened the
            // gradient to a plain surface. Inline always beats both.
            style={{
              background: "var(--vera-grad)",
              color: "var(--primary-ink)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <span aria-hidden className={s.wash} />
            {idx === i && <span aria-hidden className="sheen-sweep" />}
            {slide.art}
            <span className={s.copy}>
              <span className={s.title}>{slide.title}</span>
              <span className={s.body}>{slide.body}</span>
            </span>
            <Icon name="arrowUR" size={22} stroke={2.2} style={{ position: "relative", flex: "none" }} />
          </button>
        ))}

        {count > 1 && (
          <div className={s.dots} role="tablist" aria-label="Home highlights">
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                role="tab"
                aria-selected={idx === i}
                aria-label={slide.title}
                className={s.dot}
                data-on={idx === i ? "true" : "false"}
                onClick={() => {
                  haptic.select();
                  setI(idx);
                }}
              >
                {idx === i && !paused && <span ref={barRef} aria-hidden className={s.fill} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
