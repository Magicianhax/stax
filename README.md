<div align="center">

<img src="web/public/brand/stax-dark.png#gh-light-mode-only" alt="Stax" width="92" />
<img src="web/public/brand/stax-light.png#gh-dark-mode-only" alt="Stax" width="92" />

# Stax

**Own the world's best companies — onchain, in one tap.**

Buy fractional shares of real tokenized stocks on Mantle, guided by **Vera**, an AI agent
whose every recommendation is **signed and verified on-chain before a cent moves**.

Built for the **Mantle Turing Test Hackathon 2026** · targeting **AI × RWA** and **AI × Trading & Strategy (BGA)**

<img src="docs/demo.gif" alt="Stax demo" width="640" />

[▶ Watch the full demo](web/public/stax.mp4) · [Contracts on Mantlescan ↓](#deployed-contracts-mantle-mainnet--chainid-5000--verified-on-mantlescan)

</div>

---

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

A flat **25 bps (0.25%)** on capital deployed (buys + AI invests), taken as a gasless USDC
transfer to the treasury batched into the same UserOp. Gas stays on us. No spreads, no
subscription. (`web/src/lib/fees.ts`, configurable via `NEXT_PUBLIC_STAX_FEE_BPS`.)

## Tech

Next.js 16 (App Router, PWA) · Tailwind v4 · **Privy** (email/passkey embedded wallet,
delegated session signers) · **Pimlico + permissionless** (gasless ERC-4337, SimpleAccount v0.7)
· viem / wagmi · **Anthropic** via the AI SDK (Vera) · Fluxion / Agni / Merchant Moe (Mantle
DEXes) · Backed xStocks · Alchemy RPC + Etherscan V2 (tx history) · Hardhat contracts.

## Run it locally

```bash
# contracts are already deployed + verified on mainnet; only needed to redeploy
cd contracts && npm install

cd ../web && npm install
cp .env.example .env.local      # fill in the keys below
npm run dev                     # http://localhost:3000  (landing) · /app (the product)
```

**Required env** (full list in `web/.env.example`): `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_SECRET`,
`PIMLICO_API_KEY`, `ANTHROPIC_API_KEY`, `AGENT_SIGNER_PRIVATE_KEY` (server-only — signs risk
inferences), `ETHERSCAN_API_KEY`, the deployed contract addresses, and
`NEXT_PUBLIC_STAX_EXECUTOR_BLOCK`. Optional: `ALCHEMY_API_KEY`, plus `PRIVY_AUTHORIZATION_KEY` +
`AUTOPILOT_CRON_SECRET` for Autopilot.

> Funds live on the **smart-account** address (the ERC-4337 account), not the Privy embedded EOA
> that owns it. The app always derives and shows the smart account.

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
