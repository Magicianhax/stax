"use client";

// Stax marketing site (route "/"). Recreated from the Stax design handoff v6
// (Landing.html) and adapted to our brand: Fraunces display, Hanken UI,
// JetBrains mono, sage glass, real Vera asset. Light by default with a persisted
// dark toggle. The hero phone mirrors the real in-app Home screen; the three
// asset chips around it sit STILL (no orbit spin). Copy is em-dash-free; the
// Vera stat band / records and marquee figures are illustrative sample data.
// All CTAs route to /app.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, Sun, Moon, Menu, KeyRound, Zap, BadgeCheck, ChevronDown } from "lucide-react";
import { displayFor } from "@/lib/displayAssets";
import { FAQ } from "@/lib/faq";
import { DemoMount } from "@/components/demo/DemoMount";
import type { DemoPlay } from "@/components/demo/DemoProvider";
import { PhoneChrome } from "@/components/site/PhoneChrome";
import { LoopVideo } from "@/components/site/LoopVideo";

type Mode = "light" | "dark";

// Premium icon set (lucide-react), same family the in-app UI uses.
const Arrow = ({ size = 18 }: { size?: number }) => <ArrowRight size={size} strokeWidth={2.2} />;

/** Mantle's official logo — shown beside the Mantle name wherever it appears. */
function MantleLogo({ size = 16 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/partners/mantle.png" alt="Mantle" width={size} height={size} decoding="async" style={{ width: size, height: size, display: "block", flex: "none" }} />
  );
}

/** The real Stax app-icon logo (light mark used in both themes, per brand). */
function StaxMark({ size = 30 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/stax-light.png"
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: size * 0.26, display: "block" }}
    />
  );
}

/** Small asset tile — real brand logo with a coloured-initial fallback. */
function Tile({ sym }: { sym: string }) {
  const d = displayFor(sym);
  return (
    <span className="tile" style={{ background: d.color }}>
      {d.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.logo} alt="" loading="lazy" decoding="async" />
      ) : (
        d.glyph ?? d.name[0]
      )}
    </span>
  );
}

function fmtPrice(p?: number): string {
  if (p == null) return "";
  return p >= 1000 ? "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "$" + p.toFixed(2);
}

/** Price + day move (▲/▼ %, or APY for yield assets) — shared by marquee + chips. */
function Quote({ sym }: { sym: string }) {
  const d = displayFor(sym);
  if (d.apy) {
    return <span className="m-px">{fmtPrice(d.price)} <span className="m-apy">{d.apy} / yr</span></span>;
  }
  const up = d.day >= 0;
  return (
    <span className="m-px">
      {fmtPrice(d.price)} <i className={up ? "up" : "down"}>{up ? "▲" : "▼"} {Math.abs(d.day).toFixed(2)}%</i>
    </span>
  );
}

/** Hero phone: the REAL app, fully interactive and STATIC (never auto-plays) —
    visitors tap to explore it themselves. */
function HeroDemo({ mode }: { mode: Mode }) {
  return (
    <div className="demo-embed">
      <div className="demo-embed-fit">
        <DemoMount play={null} mode={mode} />
      </div>
    </div>
  );
}

/** A standalone playable phone — auto-plays its script once scrolled into view
    (lazy-mounted so the marketing page stays light on first paint). */
function DemoPhone({ play, mode }: { play: Exclude<DemoPlay, null>; mode: Mode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setShow(true); io.disconnect(); } }),
      { rootMargin: "220px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="phone" ref={ref}>
      <div className="phone-screen">
        <div className="demo-embed is-static">
          {show && (
            <div className="demo-embed-fit">
              <DemoMount play={play} mode={mode} />
            </div>
          )}
        </div>
        <PhoneChrome />
      </div>
    </div>
  );
}

const MARQUEE = ["AAPL", "NVDA", "TSLA", "GOOGL", "META", "SPY", "QQQ", "MSTR", "HOOD", "sUSDe"];

export function SiteLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("dark");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("stax-landing-mode");
    if (saved === "dark" || saved === "light") setMode(saved);
  }, []);

  const toggleMode = () => {
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      localStorage.setItem("stax-landing-mode", next);
      return next;
    });
  };

  // Scroll reveal + count-up + hide-on-scroll nav. Gated on `data-ready`.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.setAttribute("data-ready", "true");

    const reveals = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    reveals.forEach((el) => io.observe(el));
    const vh = window.innerHeight || 800;
    reveals.forEach((el) => { if (el.getBoundingClientRect().top < vh * 0.96) el.classList.add("in"); });
    const safety = window.setTimeout(() => reveals.forEach((el) => el.classList.add("in")), 2200);

    // count-up stats (Vera stat band)
    const counters = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
    const runCount = (el: HTMLElement) => {
      if (el.dataset.done) return;
      el.dataset.done = "1";
      const to = parseFloat(el.dataset.count || "0");
      const dp = parseInt(el.dataset.dp || "0", 10);
      const suffix = el.dataset.suffix || "";
      const dur = 1400;
      let start: number | null = null;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (to * eased).toFixed(dp) + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = to.toFixed(dp) + suffix;
      };
      requestAnimationFrame(step);
    };
    const countIO = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { runCount(e.target as HTMLElement); countIO.unobserve(e.target); } }),
      { threshold: 0.5 },
    );
    counters.forEach((el) => countIO.observe(el));

    const nav = root.querySelector<HTMLElement>(".nav");
    let lastY = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (nav) {
          nav.style.top = y > 200 && y > lastY ? "-110px" : "14px";
          // glass over the opening video; solid once scrolled onto page content
          // (otherwise the hero text bleeds through the translucent pill).
          nav.dataset.solid = y > window.innerHeight * 0.7 ? "1" : "";
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Liquid Glass: the specular sheen on glass buttons tracks the pointer.
    const onPointer = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      btn.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    };
    root.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      io.disconnect();
      countIO.disconnect();
      window.removeEventListener("scroll", onScroll);
      root.removeEventListener("pointermove", onPointer);
      window.clearTimeout(safety);
    };
  }, []);

  // Cross-fade between the main parts: each fades OUT as it scrolls up past the
  // top (the .reveal handles the fade-IN). Skipped under reduced-motion.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cleanup: (() => void) | undefined;
    (async () => {
      const gsapMod = await import("gsap");
      const stMod = await import("gsap/ScrollTrigger");
      const gsap = gsapMod.gsap ?? gsapMod.default;
      const ScrollTrigger = stMod.ScrollTrigger ?? stMod.default;
      gsap.registerPlugin(ScrollTrigger);
      const ctx = gsap.context(() => {
        const parts = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".hero, .video-sec, #vera, #how"));
        parts.forEach((sec) => {
          gsap.to(sec, {
            opacity: 0,
            ease: "none",
            scrollTrigger: { trigger: sec, start: "bottom 64%", end: "bottom 14%", scrub: true },
          });
        });
      }, root);
      cleanup = () => ctx.revert();
    })();
    return () => cleanup?.();
  }, []);

  const navLinks = (
    <>
      <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
      <a href="#vera" onClick={() => setMenuOpen(false)}>Meet Vera</a>
      <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
      <Link className="nav-demo" href="/demo" onClick={() => setMenuOpen(false)}>
        <span className="nav-demo-dot" /> Try the demo
      </Link>
    </>
  );

  return (
    <div className="site" data-mode={mode} ref={rootRef}>
      <div className="site-bg-mesh" />
      <div className="site-orb a" />
      <div className="site-orb b" />
      <div className="site-orb c" />

      {/* NAV */}
      <nav className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top"><StaxMark /> Stax</a>
          <div className="nav-links">{navLinks}</div>
          <div className="nav-actions">
            <button className="nav-toggle" onClick={toggleMode} aria-label="Toggle dark mode" title="Toggle theme">
              {mode === "dark" ? <Sun size={20} strokeWidth={1.9} /> : <Moon size={20} strokeWidth={1.9} />}
            </button>
            <Link className="btn btn-primary btn-sm" href="/app">Open the app</Link>
            <button className="nav-toggle nav-burger" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
              <Menu size={20} strokeWidth={2} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="nav-drop">
            <div className="nav-drop-panel glass">{navLinks}</div>
          </div>
        )}
      </nav>

      <span id="top" />

      {/* VIDEO — full-bleed product film, the opening act; copy overlaid on top.
          (drop the file at public/stax.mp4) */}
      <section className="video-sec video-first reveal" id="video">
        <div className="video-frame">
          <LoopVideo className="video-el" src="/stax.mp4" />
          <div className="video-overlay">
            <div className="video-copy">
              <span className="eyebrow"><Sparkles size={14} strokeWidth={1.9} /> Real shares, in plain words</span>
              <h2 className="serif">Just say what you want.</h2>
              <p>Vera turns your goal into a real mix of companies you know, then places it in one tap. Gas-free, and signed on-chain.</p>
              <Link className="btn btn-glass" href="/app">Open the app <Arrow size={16} /></Link>
            </div>
          </div>
        </div>
      </section>

      {/* HERO — centered (Plasma-style): headline + CTA on top, then a large phone
          with benefit callouts at the four corners. */}
      <section className="hero hero-centered">
        <div className="site-wrap">
          <div className="hero-head">
            <h1 className="serif reveal" data-d="1">Own the world&apos;s best companies.</h1>
            <p className="hero-sub reveal" data-d="2">Buy fractional shares of global stocks, directly onchain.</p>
            <div className="hero-cta reveal" data-d="3">
              <Link className="btn btn-primary" href="/app">Start Investing <Arrow /></Link>
            </div>
          </div>

          <div className="hero-showcase reveal" data-d="2">
            <div className="hero-feat hf-tl">
              <div className="hero-feat-k">Real shares</div>
              <div className="hero-feat-d">Actual companies, tokenized on-chain.</div>
            </div>
            <div className="hero-feat hf-bl">
              <div className="hero-feat-k">Self-custody</div>
              <div className="hero-feat-d">Your assets, your keys, always.</div>
            </div>
            <div className="hero-feat hf-tr">
              <div className="hero-feat-k">From $1</div>
              <div className="hero-feat-d">Buy a fraction of any stock.</div>
            </div>
            <div className="hero-feat hf-br">
              <div className="hero-feat-k">24/7 markets</div>
              <div className="hero-feat-d">Trade any time, gas-free.</div>
            </div>
            <div className="phone">
              <div className="phone-screen">
                <HeroDemo mode={mode} />
                <PhoneChrome />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE — the stock ticker slides */}
      <div className="marquee reveal">
        <div className="marquee-row">
          {[...MARQUEE, ...MARQUEE].map((sym, i) => {
            const d = displayFor(sym);
            return (
              <div className="m-item" key={sym + i}>
                <Tile sym={sym} />
                <span className="m-meta"><b>{d.name}</b><Quote sym={sym} /></span>
              </div>
            );
          })}
        </div>
      </div>

      {/* MEET VERA — playable phone LEFT, copy right (auto-plays how Vera builds + signs) */}
      <section className="sec" id="vera">
        <div className="site-wrap demo-split phone-left reveal">
          <div className="demo-copy">
            <h2 className="serif">A track record that can&apos;t be edited.</h2>
            <p className="demo-lead">
              Vera turns your goal into a plan and signs every one to a permanent on-chain record. You
              trust the numbers, not the marketing.
            </p>
            <dl className="deflist">
              <div><dt>Signed</dt><dd>Every plan carries Vera&apos;s own cryptographic signature.</dd></div>
              <div><dt>Recorded</dt><dd>Written to a permanent, public ledger that can&apos;t be edited later.</dd></div>
              <div><dt>Open</dt><dd>Anyone can audit her full history, on-chain, anytime.</dd></div>
            </dl>
            <Link className="btn btn-glass btn-sm" href="/app">See Vera in the app <Arrow size={16} /></Link>
          </div>
          <DemoPhone play="vera" mode={mode} />
        </div>
      </section>

      {/* HOW IT WORKS — copy left, playable phone RIGHT (auto-plays goal → plan → invest) */}
      <section className="sec" id="how">
        <div className="site-wrap demo-split phone-right reveal">
          <div className="demo-copy">
            <h2 className="serif">From a sentence to a real portfolio.</h2>
            <p className="demo-lead">
              Tell Vera a goal in plain words. She turns it into a real, diversified basket and places it
              in one tap. No tickers, no jargon, no paperwork.
            </p>
            <ol className="flowlist">
              <li><span className="flow-n">1</span><div><h3>Tell Vera your goal</h3><p>Say it however feels natural, like &ldquo;grow $300, mostly big tech, keep some safe.&rdquo;</p></div></li>
              <li><span className="flow-n">2</span><div><h3>Review the plan</h3><p>Named companies and funds, each with a one-line reason. Nudge it safer or bolder anytime.</p></div></li>
              <li><span className="flow-n">3</span><div><h3>Invest in one tap</h3><p>Vera buys every holding for you, instantly and gas-free, then records it on-chain.</p></div></li>
            </ol>
          </div>
          <DemoPhone play="invest" mode={mode} />
        </div>
      </section>

      {/* TRUST BAND — honest authority signals before the deeper content + CTA */}
      <section className="site-wrap" style={{ padding: "6px 22px 10px" }}>
        <div className="trust-band reveal">
          <div className="trust-item"><span className="ic"><KeyRound size={18} /></span><div><b>Non-custodial</b><span>Your assets, your keys</span></div></div>
          <div className="trust-item"><span className="ic"><Zap size={18} /></span><div><b>Gas-free</b><span>We cover every network fee</span></div></div>
          <div className="trust-item"><span className="ic ic-img"><MantleLogo size={20} /></span><div><b>On Mantle</b><span>A fast, low-cost network</span></div></div>
          <div className="trust-item"><span className="ic"><BadgeCheck size={18} /></span><div><b>Real shares</b><span>Tokenized by Backed</span></div></div>
        </div>
      </section>

      {/* WHY STAX — bento */}
      <section className="sec" id="features">
        <div className="site-wrap">
          <div className="sec-head reveal">
            <h2 className="serif">Built for your first<br />investment, and your hundredth.</h2>
          </div>
          <div className="feat-list reveal">
            <div className="feat-item">
              <h3>Investing, without the jargon</h3>
              <p>Describe a goal in a sentence. Vera turns it into a real, diversified portfolio you actually understand.</p>
              <div className="feat-proof bc-chat">
                <span className="bc-you">Something safe-ish that still grows</span>
                <span className="bc-vera">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/vera.png" alt="" /> A balanced mix, 20% kept safe →</span>
              </div>
            </div>

            <div className="feat-item">
              <h3>Trust you can check</h3>
              <p>Every recommendation is signed and written on-chain, so it can&apos;t be edited after the fact.</p>
              <div className="feat-proof bc-ledger">
                <div className="bc-led-row"><span className="mono">0x7b…41a9</span><span className="up">+6.2%</span></div>
                <div className="bc-led-row"><span className="mono">0x91…0e7f</span><span className="up">+9.4%</span></div>
                <div className="bc-led-row"><span className="mono">0xa2…7c10</span><span className="down">−1.8%</span></div>
              </div>
            </div>

            <div className="feat-item">
              <h3>Real shares, held by you</h3>
              <p>Actual stakes in Apple, Nvidia, the S&amp;P 500 and more, never a synthetic copy.</p>
              <div className="feat-proof bc-stack">
                {["AAPL", "NVDA", "SPY", "GOOGL"].map((s) => <Tile key={s} sym={s} />)}
              </div>
            </div>

            <div className="feat-item">
              <h3>Flat 25 bps, zero gas</h3>
              <p>One small fee on what you invest, and we cover every network cost. No spreads, no surprises.</p>
              <div className="feat-proof bc-big">25 bps</div>
            </div>
          </div>
        </div>
      </section>

      {/* BUILT ON — real third-party credibility, with a plain explanation of each */}
      <section className="site-wrap" style={{ padding: "10px 22px 0" }}>
        <div className="reveal">
          <div className="builton">
            <span className="builton-label">Built on</span>
            <a className="builton-logo" href="https://www.mantle.xyz" target="_blank" rel="noreferrer" aria-label="Mantle Network">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/partners/mantle.png" alt="" decoding="async" />
              <b>Mantle</b>
            </a>
            <span className="builton-div" aria-hidden />
            <a className="builton-logo" href="https://backed.fi" target="_blank" rel="noreferrer" aria-label="Backed">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/partners/backed.svg" alt="Backed" className="logo-mono" decoding="async" />
            </a>
          </div>
          <p className="builton-note">
            It settles on <b>Mantle</b>, a fast, low-cost Ethereum network. Each stock is issued by{" "}
            <b>Backed</b>, a regulated firm that holds the real share in custody and tokenizes it one-to-one,
            so what you own tracks the actual company and can be redeemed for it.
          </p>
        </div>
      </section>

      {/* FAQ — shared content (lib/faq); native <details> accordion, keyboard-accessible */}
      <section className="sec faq-sec" id="faq">
        <div className="site-wrap">
          <div className="sec-head reveal">
            <h2 className="serif">Questions you&rsquo;d<br />actually ask.</h2>
            <p>Straight answers, in the same plain words Vera uses.</p>
          </div>
          <div className="faq reveal">
            {FAQ.map((item) => (
              <details key={item.q} className="faq-item">
                <summary>
                  <span className="faq-q">{item.q}</span>
                  <span className="faq-ico" aria-hidden="true"><ChevronDown size={20} strokeWidth={2.4} /></span>
                </summary>
                <div className="faq-a">
                  <p>{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="site-wrap">
          <div className="cta-card reveal">
            <h2 className="serif">Your first investment is <span className="cta-em">one sentence</span> away.</h2>
            <p>Start with as little as $1. Tell Vera a goal, look over the plan she builds, and invest in one tap.</p>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", position: "relative" }}>
              <Link className="btn btn-primary" href="/app">Open the app</Link>
              <a className="btn btn-glass" href="#how">How it works</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="site-wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <a className="brand" href="#top" style={{ fontSize: 22 }}><StaxMark /> Stax</a>
              <p>Investing in plain words. Real companies, real shares, an assistant whose record you can verify.</p>
            </div>
            <div>
              <h4>Product</h4>
              <a href="#how">How it works</a>
              <a href="#features">Features</a>
              <Link href="/app">Open the app</Link>
            </div>
            <div>
              <h4>Learn</h4>
              <a href="#vera">Meet Vera</a>
              <a href="#how">How it works</a>
            </div>
            <div>
              <h4>Built on</h4>
              <a href="https://www.mantle.xyz" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><MantleLogo size={15} /> Mantle Network</a>
              <span style={{ display: "block", color: "var(--s-ink-3)", fontSize: 14.5 }}>Tokenized by Backed</span>
            </div>
            <div>
              <h4>Connect</h4>
              <a href="https://x.com/stax_market" target="_blank" rel="noreferrer">@stax_market on X</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 Stax. Stocks can go down as well as up, only invest what you can leave for a while.</span>
            <span className="mono">Not investment advice · Capital at risk</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
