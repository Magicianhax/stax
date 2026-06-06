# Stax — The AI Broker for Tokenized Stocks on Mantle

> Design spec / north star. Mantle **Turing Test Hackathon 2026** (Phase 2 "AI Awakening").
> Status: locked & verified on-chain (2026-06-01). Living doc — asset list is data-driven.

---

## 1. Context & vision

Web2 users want to buy stocks (and dollar yield) from their phone, without a broker, KYC wall, seed phrase, or "gas." Tokenized US equities are now **live on Mantle** (Mantle + Bybit + Backed + Flowdesk launched xStocks on Fluxion, Apr 2026; Atomic RFQ "xChange" May 2026). Nobody has built the **consumer, AI-native, self-custody front door** to them.

**Stax** is that front door: *tell an AI your goal in plain words ("$100 into the Magnificent 7, a bit safe"), and an on-chain AI agent builds the allocation across real tokenized stocks + RWA on Mantle and executes it in one tap — gasless, email login, no seed phrase.*

## 2. Why this wins (one product → four prize surfaces)

| Prize | How Stax targets it |
|---|---|
| **Grand Champion** ($9K — "business potential, completion, Mantle ecosystem fit") | Real assets through real Mantle rails (Fluxion/Backed); proven EM + retail demand; drives real TVL + DEX volume; fundable by Mantle EcoFund |
| **AI × RWA track 1st** ($8.5K) | AI bridges real tokenized equities/Treasuries to a normie UX; on-chain AI allocation agent |
| **Best UI/UX** ($3K — "smoothest onboarding for Web2 users") | Email/passkey → funded → owns a stock in <2 min, fully gasless |
| **20-Deploy** ($1K) | Verified contract on Mantle mainnet + public PWA + demo video |

Scoring rubric weights: Technical Depth 30 / Innovation 25 / Mantle Contribution 25 / Product Completeness 20.

## 3. Verified on-chain reality (the foundation — every asset is real)

**Acquisition Path 1 — Instant AMM swap (Fluxion, one-tap, USDC-paired, fee tier 3000).** Verified via `mantle_getSwapQuote` (100 USDC → 0.3193 wAAPLx ≈ $313; → 0.2276 wTSLAx ≈ $439).
10 wrapped blue-chips: `wAAPLx wTSLAx wNVDAx wGOOGLx wMETAx wMSTRx wHOODx wCRCLx wSPYx wQQQx`.

**Acquisition Path 2 — Native xStocks via Backed = NOT permissionlessly buyable on Mantle today → ROADMAP, not MVP.** ~92 native tokens are deployed on Mantle (Backed API `https://api.backed.fi/api/v2/public/assets`, filter `deployments[].network=="Mantle"`), BUT verified 2026-06-01: they have **no AMM liquidity** on Mantle (`USDC→VOOx` & `USDC→AMDx` = NO_ROUTE; `USDC/SGOVx` = 0 pools across all DEXes) and Backed's primary issuance/redemption (xChange atomic RFQ) is **KYC-gated to whitelisted authorized participants**. Secondary trading is permissionless in principle, but with no Mantle DEX pool there's nowhere to buy them. → Treat the full catalog as a **"coming soon"** tier (unlocks if/when LPs seed Mantle pools or a KYC issuance flow is added). Do NOT promise it in the MVP.

**MVP buyable universe (all verified permissionless on Mantle):** the **10 Fluxion blue-chips** (incl. SPYx = S&P 500, QQQx = Nasdaq 100 for index exposure) + **sUSDe** (safe-yield dollar; USDC→USDe→sUSDe verified on Agni/Merchant Moe) + **mETH** (LST) & **FBTC** (BTC) — deep Mantle liquidity on Merchant Moe/Agni.

Key infra: USDC `0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9` (6 dec); Fluxion router `0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0`. Full address appendix in §13.

## 4. Product — core user flows

1. **Onboard:** open PWA → "Add to Home Screen" → sign in with email/passkey (Privy embedded wallet on Mantle, no seed phrase).
2. **Fund:** "Add cash" → Transak/Banxa card → USDC delivered to the Mantle wallet (Banxa is Mantle's official ramp).
3. **Advise (the AI moment):** chat a goal → AI returns a concrete allocation across in-scope assets + a plain-language rationale + a risk score, and an "Invest" button.
4. **Invest (one tap, gasless):** AI recommendation is committed on-chain, then executed (Fluxion swaps for AMM assets + Backed issuance for native) via a sponsored ERC-4337 UserOp.
5. **Portfolio:** holdings, live P&L, Mantle Explorer links; "Explain" any asset; (stretch) "Auto-rebalance / DCA" toggle.

### Lite & Pro modes (per-user toggle; default Lite) — Pro is a SUPERSET of Lite, not a different app

The AI assistant/agent is central to **both** modes. The only difference is how much the user **sees** and **controls** — never whether AI is present.

**Lite (default):** the guided, few-clicks experience. Chat a goal → AI builds and explains the basket → one tap to invest. Shows only the essentials (one balance, simple holdings, autopilot toggle); hides slippage, routes, gas, addresses. The AI does the heavy lifting.

**Pro (everything in Lite, plus more visibility + more control):** keeps the same AI assistant, and additionally exposes —
- **See more:** live quotes, price impact, the Fluxion route, per-asset charts & 24h %, cost basis, P&L, tx receipts / Explorer links, and the agent's on-chain track record (ERC-8004 reputation).
- **Control more:** manually buy/sell individual assets, adjust slippage, edit/override the AI's proposed allocation before investing, and configure the autopilot (targets, DCA schedule, risk ceiling).

**Execution paths (either available in both modes):** AI allocation → `StaxExecutor.investWithAI` (commit + verify + multi-leg execute). Manual single buy/sell → direct gasless Fluxion swap from the embedded wallet (approve + swap UserOp). Same wallet, funding, and gasless execution across both modes. The 2-min demo leads with Lite (AI wow + Best-UX), then flips to Pro to show the depth + manual control.

## 5. The AI × on-chain feature (award centerpiece) — "Verifiable AI Allocation Agent"

Satisfies the rubric's required "AI-powered function callable on-chain" via all three accepted patterns at once:
- **Inference written on-chain:** `commitRecommendation(bytes32 recHash, uint16 riskScore, uint256 agentId)` stores `keccak256(allocationJSON)` + timestamp + the agent's **ERC-8004** tokenId → tamper-evident proof of *what* the AI advised and *which* agent advised it.
- **Automated execution:** `executeAllocation(planId)` pulls the committed plan and routes the real buys on Mantle.
- **Agent-gated decision:** execution reverts unless an on-chain **risk inference is verified** (our EIP-712 signed-inference verifier; or Allora `verifyNetworkInference` if confirmed live on Mantle) confirms market risk ≤ the user's committed ceiling.

Off-chain LLM (Claude) does NL→allocation + the natural-language explainer (UX polish — does not count toward the on-chain requirement).

## 6. Architecture (4 layers)

```
[ PWA frontend ]  Next.js + Tailwind/shadcn, mobile-first, installable
   │  Privy (auth + embedded wallet)   Pimlico/permissionless (gasless ERC-4337)   Transak (on-ramp)
   ▼
[ Agent service ]  Next.js API routes — Claude NL→allocation, risk score, EIP-712 sign,
   │               asset registry (Backed API + Fluxion pool discovery), tx building
   ▼
[ Mantle contracts ]  StaxExecutor (commit + execute) · InferenceVerifier (EIP-712) · ERC-8004 Identity Registry
   ▼
[ Mantle DeFi ]  Fluxion router (xStocks AMM) · Backed issuance (native xStocks) · Merchant Moe/Agni (mETH/FBTC/sUSDe)
```

## 7. Smart contracts (Foundry, deploy + verify on Mantle mainnet)

- **`InferenceVerifier.sol`** — EIP-712 `verify(RiskInference, signature)`; checks the agent's signed `{planId, riskScore, maxRisk, expiry}` against a trusted signer; reverts on breach/expiry. (Swap-in point for Allora later.)
- **`StaxExecutor.sol`** — `commitRecommendation(...)` (emits + stores hash, riskScore, agentId); `executeAllocation(planId, calls[])` runs the batched buys only after `InferenceVerifier` passes; non-custodial (operates on the user's approved USDC via UserOp). Slippage caps, max-spend, pause guard.
- **ERC-8004 Identity Registry** — deploy reference contracts on Mantle (open-source `github.com/erc-8004/erc-8004-contracts`); `register()` the Stax agent once → agent NFT + JSON agent card; stamp `agentId` into commits. Optional Reputation feedback post-execution.

## 8. AI agent service

Input: NL goal + funds + in-scope asset universe (from registry). Output: `allocation[]` (asset, weight, est. route), `riskScore`, `rationale`. Then: hash the allocation, EIP-712-sign the risk inference, and build the execution calls (approve + Fluxion swaps + Backed issuance) using Mantle MCP `mantle_buildSwap`/`buildApprove`/`buildRawTx` (or Viem). Guardrails: only whitelisted assets, slippage + spend caps, halted-asset filter (Backed API `isTradingHalted`).

## 9. Web2 onboarding stack (verified to support Mantle 5000)

Privy (email/passkey + embedded wallet) → Pimlico verifying paymaster (gasless; or ERC-20 paymaster paying gas in USDC) → Transak primary / Banxa fallback (card → USDC on Mantle) → `next-pwa` installable shell. Copy rules: "account" not "wallet", "Confirm with Face ID" not "sign tx", fees shown as "free/included". Free tiers cover the whole demo (testnet sponsored UserOps are free).

## 10. Tech stack

Next.js (App Router, TS — installed version has breaking changes vs. older docs; consult `node_modules/next/dist/docs/`) · Tailwind + shadcn/ui · wagmi/viem · Privy · permissionless.js (Pimlico) · Transak (optional) · Hardhat 2 + viem (contracts) · **Vercel AI Gateway via `ai` SDK v6** (`generateObject`, model `anthropic/claude-sonnet-4.6`, env `AI_GATEWAY_API_KEY`) · Vercel (frontend host) · Mantle MCP (read + tx-build).

## 11. MVP demo scope (the <2-min winning demo)

Email login → (pre-funded or Transak) USDC on Mantle → chat *"Invest $20: mostly Magnificent 7, a little safe"* → AI shows allocation (e.g. NVDA/AAPL/TSLA/META/GOOGL via Fluxion + sUSDe for the safe slice) + rationale → tap **Invest** → on-chain `commitRecommendation` (hash + ERC-8004 id) → `executeAllocation` buys via Fluxion, gasless, gated by verified inference → portfolio shows the holdings with Explorer links. Stretch: weekly auto-rebalance toggle.

## 12. Build phases → see `../tasks/todo.md`

## 13. Risks & open questions

- **Gasless on mainnet:** Pimlico paymaster needs funding; real buys spend real USDC — fund a small demo float (~$20–50).
- **Native xStocks permissioning — RESOLVED (2026-06-01):** native Backed catalog is NOT permissionlessly buyable on Mantle (no DEX pools; issuance KYC-gated). MVP stock universe = the 10 Fluxion wrapped blue-chips (incl. SPYx/QQQx for index exposure). Native catalog = roadmap.
- **Fluxion router integration:** confirm exact router ABI/path for contract-initiated swaps vs client-side UserOp execution. Leaning: client builds batched UserOp; contract records commit + verifies inference (simplest, non-custodial). Revisit in Phase 1.
- **ERC-8004 on Mantle:** likely self-deploy reference contracts (treat cross-chain availability as roadmap).
- **Allora on Mantle:** not confirmed live — keep as optional, never a hard dependency.

## 14. Verified address appendix (Mantle mainnet, chainId 5000)

### Stax contracts — DEPLOYED to Mantle mainnet (2026-06-01)
- **StaxExecutor** `0x3411196abdc3dbe59c5e2878c44d1931a975af12`
- **InferenceVerifier** `0x1eba56412e02a88f17a7dfa878494b3dfd4e0d1b`
- **IdentityRegistry** `0x9f147a87f131408dd0bd750c16ac782620572abf` (Stax agent = agentId 1)
- Agent signer `0xA3F76200c22cA671Df1a2c951B521E1EA99C3E12` · Deployer `0xc6D7709dD8bA53832bd578A88260f8b8E59Fb4C7`
- _Status: deployed + whitelisted (Fluxion router + 10 stock tokens). Contract verification on Etherscan V2 pending API key._

### Tokens / infra
- USDC `0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9` (6) · Fluxion router `0x5628a59dF0ECAC3f3171f877A94bEb26BA6DFAa0`
- wAAPLx `0x5aa7649fdbda47de64a07ac81d64b682af9c0724` (pool `0x2cc6A607F3445d826B9E29f507B3A2E3B9dae106`)
- wTSLAx `0x43680abf18cf54898be84c6ef78237cfbd441883` (pool `0x5E7935d70b5d14b6Cf36fbde59944533FAb96B3C`)
- Fluxion USDC pools — wNVDAx `0xa875ac23d106394d1baaae5bc42b951268bc04e2` · wGOOGLx `0x66960ed892daf022c5f282c5316c38cb6f0c1333` · wMETAx `0x782bd3895a6ac561d0df11b02dd6f9e023f3a497` · wMSTRx `0x0e1f84a9e388071e20df101b36c14c817bf81953` · wHOODx `0x4e23bb828e51cbc03c81d76c844228cc75f6a287` · wCRCLx `0x43cf441f5949d52faa105060239543492193c87e` · wSPYx `0x373f7a2b95f28f38500eb70652e12038cca3bab8` · wQQQx `0x505258001e834251634029742fc73b5cab4fd67d`
- Native xStocks (Backed) — VOOx `0xffae0b911cb2cb7b49fd75011d99d137c040a9ef` · SGOVx `0x2dafa4732c8c1b25701a33b05f10f437f9599326` · IWMx `0xdadfb355c6110eda0908740d52c834d6c2bcddc7` · AMDx `0x3522513e5f146a2006e2901b05f16b2821485e19` · TSMx `0x9e3bf4ecfc44eedd624f26656b6736a3f093b073` (full list via Backed API)
- sUSDe `0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2` · USDe `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` · mETH `0xcDA86A272531e8640cD7F1a92c01839911B90bb0` · FBTC `0xC96dE26018A54D51c097160568752c4E3BD6C364`
