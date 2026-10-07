"use client";

// The Home hero invite. Two messages on one swipeable track — invest with Vera,
// and gift a basket. It advances on its own every few seconds, and a drag takes
// over the moment a finger lands: the track follows the finger, rubber-bands
// past the ends, and settles on the nearest slide when you let go, with a flick
// counting even when it barely moves.
//
// Gifting only joins once its contract is live on this chain, so one slide with
// no dots and no gesture is the normal case, not a special one.
//
// Auto-advance pauses while the tab is hidden, while a pointer rests on the card,
// and for a while after any manual move — someone who just chose a slide should
// not have it taken away.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, VeraOrb } from "@/components/design";
import { useGiftsEnabled } from "@/hooks/useGifts";
import { useChain } from "@/lib/chains/active";
import { useChainReady } from "./useChainReady";
import { haptic } from "@/lib/haptics";
import s from "./HomeBanners.module.css";

const ROTATE_MS = 6000;
/** Quiet the timer for this long after a manual swipe or dot tap. */
const MANUAL_QUIET_MS = 12_000;
/** Past this fraction of the card's width, the release lands on the next slide. */
const COMMIT_FRACTION = 0.25;
/** …or past this speed, whatever the distance (px per ms). */
const FLICK_VELOCITY = 0.45;
/** How far the track may stretch past the first or last slide. */
const RUBBER = 0.32;
/** Movement beyond this is a drag, not a tap. */
const TAP_SLOP = 6;

interface Slide {
  id: string;
  title: string;
  body: string;
  art: React.ReactNode;
  onOpen: () => void;
}

export function HomeBanners({ go }: { go: (screen: string, params?: Record<string, unknown>) => void }) {
  const chain = useChain();
  // `investable`, not `ready`: BNB Chain invests straight from the account without an executor.
  const { investable } = useChainReady();
  const giftsOn = useGiftsEnabled();

  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [
      {
        id: "vera",
        title: "Invest with Vera",
        body: investable
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
            <Icon name="gift" size={24} stroke={2.1} />
          </span>
        ),
        onOpen: () => go("gift"),
      });
    }
    return out;
  }, [chain.name, giftsOn, go, investable]);

  const count = slides.length;
  const [rawIndex, setIndex] = useState(0);
  // Derived, not corrected in an effect: if the slide set shrinks (gifting
  // switched off mid-session) the index simply wraps on the next render.
  const i = count ? rawIndex % count : 0;

  const [paused, setPaused] = useState(false);
  const quietUntil = useRef(0);
  const goTo = useCallback((next: number) => {
    quietUntil.current = Date.now() + MANUAL_QUIET_MS;
    setIndex(next);
  }, []);

  // ── swipe ────────────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; t0: number; width: number; moved: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dx, setDx] = useState(0);
  // How far the last gesture travelled, kept in a ref because the click that
  // follows pointerup fires AFTER state has reset — reading `dx` there would
  // always see 0, and every swipe would also open the card.
  const swiped = useRef(0);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      t0: e.timeStamp,
      width: trackRef.current?.offsetWidth ?? 1,
      moved: 0,
    };
    swiped.current = 0;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    let moved = e.clientX - d.x0;
    // Rubber-band at the ends: the track still gives, but grudgingly.
    if ((i === 0 && moved > 0) || (i === count - 1 && moved < 0)) moved *= RUBBER;
    d.moved = moved;
    swiped.current = Math.abs(moved);
    setDx(moved);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const moved = e.clientX - d.x0;
    const velocity = Math.abs(moved) / Math.max(1, e.timeStamp - d.t0);
    const far = Math.abs(moved) > d.width * COMMIT_FRACTION;
    const flick = velocity > FLICK_VELOCITY && Math.abs(moved) > TAP_SLOP;
    const next =
      far || flick ? (moved < 0 ? Math.min(i + 1, count - 1) : Math.max(i - 1, 0)) : i;
    drag.current = null;
    setDragging(false);
    setDx(0);
    if (next !== i) {
      haptic.select();
      goTo(next);
    } else if (Math.abs(moved) > TAP_SLOP) {
      // Came back to where it started: mark it manual so the timer doesn't
      // immediately move what the person just held in place.
      quietUntil.current = Date.now() + MANUAL_QUIET_MS;
    }
  };

  // ── auto-advance ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (count < 2 || paused || dragging) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < quietUntil.current) return;
      setIndex((prev) => (prev + 1) % count);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused, dragging]);

  // Restart the progress fill on every change, whatever caused it.
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
        <div
          ref={trackRef}
          className={s.viewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Vertical scrolling still belongs to the page; only the horizontal
          // axis is ours.
          style={{ touchAction: count > 1 ? "pan-y" : undefined }}
        >
          <div
            className={s.track}
            data-dragging={dragging ? "true" : "false"}
            style={{ transform: `translate3d(calc(${-i * 100}% + ${dx}px), 0, 0)` }}
          >
            {slides.map((slide, idx) => (
              <button
                key={slide.id}
                onClick={() => {
                  if (swiped.current > TAP_SLOP) return; // a drag is not a tap
                  haptic.light();
                  slide.onOpen();
                }}
                className={`card tap ${s.slide}`}
                tabIndex={idx === i ? 0 : -1}
                aria-hidden={idx !== i}
                // Inline, not in the module: the global `.card` rule sets its own
                // background and wins on source order, which silently flattened
                // the gradient to a plain surface. Inline beats both.
                style={{
                  background: "var(--vera-grad)",
                  color: "var(--primary-ink)",
                  boxShadow: "var(--shadow-lg)",
                }}
              >
                <span aria-hidden className={s.wash} />
                {slide.art}
                <span className={s.copy}>
                  <span className={s.title}>{slide.title}</span>
                  <span className={s.body}>{slide.body}</span>
                </span>
                <Icon name="arrowUR" size={22} stroke={2.2} style={{ position: "relative", flex: "none" }} />
              </button>
            ))}
          </div>
        </div>

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
                  goTo(idx);
                }}
              >
                {idx === i && !paused && !dragging && <span ref={barRef} aria-hidden className={s.fill} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
