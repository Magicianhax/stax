# Stax — Product Brief (for design)

> Purpose of this doc: explain **what Stax is, who it serves, and how it works** so a designer can craft the UX, interface, and interactions. It intentionally does **not** prescribe colors, fonts, or visual patterns — that's the designer's call. It focuses on the product, the users, the flows, the screens, and the states each screen can be in.

---

## 1. What Stax is (in one line)

**Stax is an AI broker that lets anyone buy real tokenized stocks from their phone — just tell it your goal in plain words, and it builds and places the whole investment in one tap.**

It runs on the Mantle blockchain under the hood, but the user never has to know or care about that. There are no brokers, no paperwork, no "crypto wallet" setup, no jargon, and no network fees shown to the user.

## 2. Who it's for

- **Everyday people who have never invested** and find brokerages and crypto equally intimidating.
- **Mobile-first users**, especially in places where opening a US brokerage account is hard but a phone + internet is universal.
- A secondary audience of **confident users** who *do* know markets and want hands-on control (served by "Pro" mode, below).

The guiding persona: someone who can use a banking or payments app comfortably, but has never bought a stock and doesn't know what a "ticker" or "wallet" is.

## 3. The core promise

1. **Say what you want, get a real portfolio.** "Grow $100, mostly big tech, keep a little safe" → an actual basket of real assets, explained simply.
2. **One tap to invest.** No forms, no confirmations full of hex codes, no fees to think about.
3. **Real ownership.** These are real tokenized shares (Apple, Tesla, Nvidia, the S&P 500, etc.) that track the real share price — not a game or a simulation.
4. **No barriers.** Sign in with email, Google, or X (or connect an existing wallet). No seed phrases, no passwords to manage.

## 4. The mental model (how a user should think about it)

- "It's an app where I **tell an assistant what I want** and it **invests for me**."
- A single **balance** that goes up and down, plus the **things I own** (companies/funds), each shown by a familiar name and logo (Apple, not a token address).
- An **AI helper** that I can talk to in plain language, that explains everything, and that I can trust because its track record is recorded and visible.

## 5. Two modes: Lite and Pro

The AI assistant is present in **both** modes. The difference is how much the person sees and controls. Mode is a simple toggle, remembered per user; **Lite is the default.**

### Lite (default — for beginners)

The guided, few-taps experience. The person:

1. Sees one clear balance and a friendly prompt.
2. Types a goal in their own words (and an amountF).
3. Reviews a simple plan the AI built — a few named holdings with how much goes into each and a one-line reason, plus a plain-language summary and a sense of how risky it is.
4. Taps **Invest** once. Done. Sees what they now own.

Lite hides everything technical: no percentages-of-percentages, no routes, no fees, no addresses. The feeling should be: *calm, encouraging, "I got this for you."*

### Pro (for confident users — everything Lite has, plus more)

Same AI assistant, but with the curtain pulled back:

- **See more:** live prices, more detail on each holding, performance/gains, transaction history/receipts, and the assistant's track record.
- **Control more:** browse the full list of available assets, manually buy or sell a single asset, adjust how much price movement they'll tolerate on a trade, and tweak the AI's proposed plan before committing.

Pro should feel **powerful and information-dense but still clean** — for someone who wants the details, not someone who's scared of them.

## 6. Key screens & flows the designer needs to cover

**A. First run / signed-out (landing)**

- A short, confidence-building intro to what Stax does.
- One primary action to get in. Sign-in options: email, Google, X, or connect an existing wallet.
- States: default; "signing in" (in progress); error (sign-in failed).

**B. Account / funding**

- After sign-in, the person has an account that can hold money (a balance, shown in dollars).
- They need a way to **add funds** (put money in) and see their available balance.
- States: empty (no funds yet — needs gentle guidance to add money); funded; adding funds (in progress).

**C. Lite — the core loop**

1. **Goal input:** a conversational prompt where they describe what they want + how much.
2. **Thinking:** the AI is building the plan (a brief, reassuring wait state).
3. **Plan review:** the proposed basket — each holding (familiar name + logo), how much of their money goes to it, a one-line "why," an overall plain-language summary, and a simple indication of risk (low → high). One clear **Invest** action.
4. **Placing the investment:** a short progress state (it's happening on-chain, gasless — present it as "securing your investment," not as a blockchain transaction).
5. **Success:** what they now own, the amount invested, and a way to view the record. Encouraging tone.

- Error states throughout: couldn't build a plan, not enough funds, the investment didn't go through (with a friendly retry).

**D. Portfolio / holdings**

- What they own, each as a familiar name with an approximate current value, and a total.
- Empty state (nothing yet) vs. populated.

**E. Pro — additional surfaces**

- **Asset browser:** the full menu of buyable things (individual companies and broad funds/ETFs), searchable, each with a price and short identity. Some assets may be marked "coming soon."
- **Manual buy/sell:** pick an asset, enter an amount, see an estimated result and a tolerance control, confirm.
- **Detail/receipt views:** transaction confirmations and a link to the permanent on-chain record.

**F. The AI agent's identity / trust signal**

- Somewhere, surface that the AI assistant has a **verifiable, permanent on-chain identity and track record** — this is a core trust differentiator. Design a small, tasteful way to convey "this advice is accountable and recorded," without being noisy.

## 7. Content & voice (very important)

- **Plain language, always.** Never show crypto/finance jargon to the user. Replace: "wallet" → "account"; "gas/network fee" → "free"; "transaction/sign" → "confirm" / "secure"; "token" → the actual company/fund name; "swap" → "buy."
- Warm, encouraging, honest. It should feel like a smart friend who happens to be great at money — not a trading terminal and not a hype machine.
- Be truthful about risk in human terms (e.g., "stocks can go down too," "this part earns a variable rate that can change").

## 8. What's true under the hood (context only — keep it invisible to users)

- Real tokenized US stocks/ETFs (Apple, Tesla, Nvidia, Google, Meta, MicroStrategy, Robinhood, Circle, the S&P 500, the Nasdaq-100) are bought on Mantle. There's also a "safe/earn" option (a yield-bearing dollar) and crypto blue-chips, shown over time.
- Investing is **gasless** (the app sponsors network costs) and **non-custodial** (the user owns their assets).
- The AI's recommendation is recorded on-chain under the assistant's identity, which is why we can show a real, verifiable track record.
- None of this should leak into the everyday UI as technical language — it's the "why you can trust it," translated into human terms.

## 9. Constraints the design must respect

- **Mobile-first, always.** The product is used primarily on phones and is installable like an app (works full-screen). On larger screens it should still feel like a focused, phone-sized experience rather than a sprawling dashboard.
- **Speed and few steps.** The headline experience (sign in → fund → invest) should feel achievable in about two minutes.
- **Accessible and beginner-safe.** Big, obvious actions; forgiving error handling; nothing that punishes a first-timer for not knowing finance terms.

## 10. What "great" looks like (UX goals to design toward)

1. A complete newcomer can go from "I've never invested" to "I own a piece of Apple" without feeling lost or scared.
2. The AI moment feels genuinely helpful — like it understood them — not gimmicky.
3. Trust is felt at every step (clarity, honesty about risk, the sense that this is real and accountable).
4. Pro users feel respected with depth and control, without it bleeding into and complicating the Lite experience.
5. It feels like a delightful consumer product, not a crypto tool.

## 11. Out of scope for this brief (designer's domain)

Color palette, typography, iconography style, motion language, specific component styling, and the visual system are intentionally **not** specified here — design them to best serve the product, users, and goals above.