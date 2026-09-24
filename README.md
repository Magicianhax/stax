<div align="center">

<img src="web/public/brand/stax-dark.png#gh-light-mode-only" alt="Stax" width="92" />
<img src="web/public/brand/stax-light.png#gh-dark-mode-only" alt="Stax" width="92" />

# Stax

**Own the world's best companies — onchain, in one tap.**

Buy fractional shares of real tokenized stocks on Base and Mantle, guided by **Vera**, an AI agent
whose every recommendation is **signed and verified on-chain before a cent moves**.

An AI agent that turns plain-language goals into risk-managed, verifiable RWA portfolios — built for the **Mantle Turing Test Hackathon 2026**.

<img src="docs/demo.gif" alt="Stax demo" width="640" />

### [▶ Live at stax.best](https://stax.best)

[Watch the full demo](web/public/stax.mp4) · [Contracts on Base ↓](#deployed-contracts-base-mainnet--chainid-8453) · [Contracts on Mantlescan ↓](#deployed-contracts-mantle-mainnet--chainid-5000--verified-on-mantlescan)

</div>

---

## Stax on BNB Chain — the broker that knows the market is closed

Built for the **BNB Hack: Tokenized Stocks Edition**. On BNB Chain (BSC mainnet, chain 56) Stax
trades **bStock** and **Ondo** tokenized stocks with USDT, and Vera plans around three things
only the Binance RWA Data API tells her:

- **Is the real market open?** Each token carries its issuer's trading status and the US
  session. When NVDA's issuers aren't trading, the buy button says "Market closed · opens …" in
  your own time zone, the server refuses the quote, and Vera leaves NVDA out of a plan and tells
  you why.
- **How far is the token from the real share?** Every stock page shows the on-chain price next
  to the reference share price, and the gap between them.
- **Which issuer is closer?** 40 of the 42 stocks are listed by both bStock and Ondo. Stax shows
  both side by side and buys the one that is trading and closest to the real share, unless you
  pick the other.

Every leg is at least $6, because Binance won't quote less than that; Vera sizes plans to fit.
Trades go from your own smart account straight to the Binance aggregator in one sponsored,
gasless transaction (exact-amount approval, then the swap), and there is no Stax fee on BSC.

**Binance Web3 API, and where Stax uses it**

| Module | Endpoint | Used for | Code |
|---|---|---|---|
| RWA Data | `/market/rwa/tokens` | catalog, market status, prices, gaps, best issuer, closed-market refusals | `web/src/lib/server/rwaCatalog.ts`, `app/api/rwa`, `app/api/swap-quote` |
| RWA Data | `/market/rwa/underlying-profile` | company details on the stock page | `app/api/rwa/[ticker]` |
| Market | `/market/candles` | the stock page chart | `app/api/rwa/[ticker]` |
| Trading | `/aggregator/quote`, `/aggregator/swap` | every BSC buy and sell, manual or Vera's | `web/src/lib/server/binanceLegs.ts` |

The Transaction API's `simulate` was used during development to check swap calldata (see
`docs/BINANCE-WEB3.md` §10); it is not called by the running app. All requests are signed on the
server, rate-limited to Binance's budget and cached; the key never reaches the browser.

**Try it:** [app.stax.best](https://app.stax.best) → Settings → Network → **BNB Chain**. Stax is
in private beta; judges get in with the invite link in the submission form.

## What makes it different — verifiable AI, on-chain

Most "AI × crypto" entries are a chatbot wrapped around a static product. Stax puts the AI
**inside the on-chain transaction** — the contract refuses to move funds unless the AI's signed
risk assessment passes verification:

```
Goal → /api/allocate          Vera turns plain words into a real allocation
     → /api/invest-plan        the server SIGNS an EIP-712 risk inference with the agent key
     → one gasless UserOp → StaxExecutor.investWithAI(...)
          → InferenceVerifier.verify(...)   reverts unless the signature is valid,
                                            assessedRisk ≤ maxRisk, and not expired
          → swaps execute (Fluxion / Agni)  emits RecommendationCommitted / AllocationExecuted
     → the app reads the events back for the receipt + Vera's public track record
```

That's the "provable, not just promised" guarantee on the success screen: the advice is
cryptographically signed and checked by a contract, not a marketing claim.

## How tracking works — the chain *is* the database

No off-chain DB. `StaxExecutor` emits an event on every action; the app reads them with
`getLogs` (`web/src/lib/onchainHistory.ts`):

| Event | Emitted when | Drives |
|---|---|---|
| `RecommendationCommitted(planId, user, recHash, riskScore, agentId)` | a plan is committed | "Plans built" |
| `AllocationExecuted(planId, user, usdcSpent, legCount)` | the invest executes | "Placed" + "$ invested" |
| `LegFilled(planId, tokenOut, usdcIn, received)` | each swap leg fills | per-asset detail |

Vera's reputation comes from `IdentityRegistry.reputationScore(agentId)`. Anyone can audit her
entire history on-chain — nothing is editable after the fact.

## Deployed contracts (Base mainnet · chainId 8453)

| Contract | Address | Role |
|---|---|---|
| **StaxExecutor** | [`0xed08d94c2722083b0b742ef9b55e81046c54deb3`](https://basescan.org/address/0xed08d94c2722083b0b742ef9b55e81046c54deb3) | Commits the recommendation, calls the verifier, runs the swaps (non-custodial), emits the tracking events. Whitelisted venues: KyberSwap MetaAggregationRouterV2, Uniswap V3 SwapRouter02, Aave v3 Pool. |
| **InferenceVerifier** | [`0x9a08b9d39170eb07268a5ac99015e062e2f39256`](https://basescan.org/address/0x9a08b9d39170eb07268a5ac99015e062e2f39256) | EIP-712 gate: `verify()` reverts unless the signature recovers to the agent signer, `assessedRisk ≤ maxRisk`, and `block.timestamp ≤ expiry`. |
| **IdentityRegistry** | [`0x0a2028dd72dd1e000f40c2c81171dd345d240a23`](https://basescan.org/address/0x0a2028dd72dd1e000f40c2c81171dd345d240a23) | ERC-8004-style agent identity (Vera = **agentId 1**) + reputation/feedback. |

Agent signer `0xA3F76200c22cA671Df1a2c951B521E1EA99C3E12` · executor deploy block `50954408` · deployed 2026-09-06.
Assets: Coinbase tokenized stocks (NVDAc GOOGLc AAPLc METAc SPCXc TSLAc AMZNc MSFTc MSTRc COINc CRCLc), cbBTC, WETH, aBasUSDC.

## Deployed contracts (Mantle mainnet · chainId 5000 · verified on Mantlescan)

| Contract | Address | Role |
|---|---|---|
| **StaxExecutor** | [`0x3411196abdc3dbe59c5e2878c44d1931a975af12`](https://mantlescan.xyz/address/0x3411196abdc3dbe59c5e2878c44d1931a975af12) | Commits the recommendation, calls the verifier, runs the swaps (non-custodial), emits the tracking events. Router/asset whitelists + slippage guards. |
| **InferenceVerifier** | [`0x1eba56412e02a88f17a7dfa878494b3dfd4e0d1b`](https://mantlescan.xyz/address/0x1eba56412e02a88f17a7dfa878494b3dfd4e0d1b) | EIP-712 gate: `verify()` reverts unless the signature recovers to the agent signer, `assessedRisk ≤ maxRisk`, and `block.timestamp ≤ expiry`. |
| **IdentityRegistry** | [`0x9f147a87f131408dd0bd750c16ac782620572abf`](https://mantlescan.xyz/address/0x9f147a87f131408dd0bd750c16ac782620572abf) | ERC-8004-style agent identity (Vera = **agentId 1**, an ERC-721 with an agent-card `tokenURI`) + reputation/feedback. |

Agent signer `0xA3F76200c22cA671Df1a2c951B521E1EA99C3E12` · executor deploy block `96098605`.
Sources in `contracts/contracts/*.sol` (Hardhat, Solidity 0.8.24, EVM `cancun`, OpenZeppelin 5.6).

## What you can do

- **Invest with Vera** — say a goal in plain words ("grow $300, mostly big tech, keep some safe"),
  review the named plan, place it in one tap. Gasless, with the on-chain-verified receipt.
- **Trade manually** — buy or sell any listed asset with live Fluxion/Agni quotes and charts.
- **Wallet** — balance, send/receive (QR), holdings with live prices, and full incoming/outgoing
  transaction history (Etherscan V2 on Mantle).
- **Autopilot** — delegate your embedded wallet (Privy session signer) so Vera invests on a
  schedule, autonomously and gaslessly, **within hard bounds** (per-period cap + risk ceiling)
  you authorize, revocable any time. *(Delegation + bounded config are live; the scheduled
  executor is in progress.)*
- **Gasless onboarding** — sign in with email or passkey, no seed phrase; funds live in an
  ERC-4337 smart account and Stax sponsors every gas fee.

## Assets

**Buyable now:** Apple, Nvidia, Tesla, Google, Meta, Robinhood, Circle, Strategy (stocks) and
S&P 500, Nasdaq-100 (funds) — real **Backed xStocks** routed through Fluxion — plus **Safe
Dollars (sUSDe)** for steady yield and **Staked ETH (mETH)**, both via Agni.

**Coming soon:** Bitcoin (FBTC), US Treasuries (Ondo USDY), and Mantle USD (mUSD) — all live on
Mantle, added to Stax once they're buyable without paperwork.

## Revenue

On Base and Mantle, a flat **25 bps (0.25%)** on capital deployed (buys + AI invests), taken as a gasless USDC
transfer to the treasury batched into the same UserOp. Gas stays on us. No spreads, no
subscription. (`web/src/lib/fees.ts`, configurable via `NEXT_PUBLIC_STAX_FEE_BPS`.) No fee on BNB Chain during the hackathon (ADR-0007).

## Tech

Next.js 16 (App Router, PWA) · Tailwind v4 · **Privy** (email/passkey embedded wallet,
delegated session signers) · **Pimlico + permissionless** (gasless ERC-4337, SimpleAccount v0.7)
· viem / wagmi · **Anthropic** via the AI SDK (Vera) · **KyberSwap Aggregator** (Base swap venue:
Aerodrome / Uniswap v3+v4 routing, Router02 fallback) + Aave v3 (Base) · Fluxion /
Agni / Merchant Moe (Mantle DEXes) · Coinbase tokenized stocks + Backed xStocks · Alchemy RPC +
Etherscan V2 (tx history) · Hardhat contracts.

## Run it locally

```bash
# contracts are already deployed + verified on Mantle; Base needs a one-time deploy (below)
cd contracts && npm install

cd ../web && npm install
cp .env.example .env.local      # fill in the keys below
npm run dev                     # http://localhost:3000  (landing) · /app (the product)
```

**Required env** (full list in `web/.env.example`): `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_SECRET`,
`PIMLICO_API_KEY`, `ANTHROPIC_API_KEY`, `AGENT_SIGNER_PRIVATE_KEY` (server-only — signs risk
inferences), `ETHERSCAN_API_KEY`, the deployed contract addresses,
`NEXT_PUBLIC_STAX_EXECUTOR_BLOCK`, and `DATABASE_URL` + `DATABASE_URL_UNPOOLED` (Postgres on
[Neon](https://neon.com) — pooled for the app, direct for migrations). Optional:
`ALCHEMY_API_KEY`, plus `PRIVY_AUTHORIZATION_KEY` + `AUTOPILOT_CRON_SECRET` (or Vercel's
`CRON_SECRET`) for Autopilot.

**Database** (Neon Postgres + Drizzle, `web/src/lib/db/`): the schema lives in `schema.ts`;
SQL migrations are generated into `web/drizzle/` and applied with

```bash
npm run db:generate   # after editing schema.ts
npm run db:migrate    # applies pending migrations over DATABASE_URL_UNPOOLED
npm run db:smoke      # round-trips an autopilot claim against the database, prints OK
```

Autopilot scheduling is a Vercel Cron on `/api/cron/autopilot` (`web/vercel.json`), daily at
09:00 UTC — the most a Hobby plan allows. On Pro, change the schedule to `0 * * * *` (hourly)
so daily-cadence autopilots run closer to their slot.

> Funds live on the **smart-account** address (the ERC-4337 account), not the Privy embedded EOA
> that owns it. The app always derives and shows the smart account.

### Deploy to Base

```bash
cd contracts && cp .env.example .env   # PRIVATE_KEY (a little ETH on Base), AGENT_SIGNER_ADDRESS, ETHERSCAN_API_KEY
npm run check:base                     # read-only: tokens, decimals, router factory, Aave aToken, pools
npm run deploy:base                    # deploys the 3 contracts, whitelists venues + assets, registers Vera
```

`deploy:base` prints the `NEXT_PUBLIC_*_BASE` lines for `web/.env.local` and the three
`npx hardhat verify --network base ...` commands (Etherscan V2 key covers Basescan). Later, when a
"coming soon" stock gets its USDC pool: set `STAX_EXECUTOR_BASE` (and optionally `EXTRA_ASSETS`)
in `contracts/.env` and run `npm run enable:base`. `npm run deploy:base-sepolia` targets Base Sepolia.

## Repo layout

```
contracts/   Hardhat workspace — StaxExecutor / InferenceVerifier / IdentityRegistry + deploy scripts
web/         Next.js PWA — app/ (routes + API), src/components, src/lib, src/hooks
docs/        spec + README assets
```

## Security

Server routes require a verified Privy session; the Pimlico relay is auth-gated and
method-allowlisted; swaps enforce on-chain `amountOutMinimum` plus a price-impact ceiling; the
agent key is server-only. Hardening (auth, rate-limiting, input bounds, headers) lives across
`web/src/lib/server/*`.
