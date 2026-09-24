# Decisions

Append-only. Never edit or delete an entry; supersede it with a new one. Entries are written by
the lead session after the human has read the reasoning (critic output is never pasted in unread).

Format:

```
## ADR-NNNN <title> (YYYY-MM-DD)
**Status:** proposed | accepted | superseded by ADR-NNNN
**Context:** what forced the decision, in two sentences
**Decision:** what was chosen
**Consequences:** what becomes easier, what becomes harder, what must now be true
```

---

## ADR-0001 Adopt this template (2026-09-24)
**Status:** accepted
**Context:** Project bootstrapped from `~/.claude/templates/project` at the start of the BNB Hack
work, after running for weeks without durable product or architecture docs.
**Decision:** `PRODUCT.md`, `docs/ARCHITECTURE.md` and this log are the durable context;
`tasks/todo.md` is the working plan. `tasks/` is gitignored in this repo, so the plan lives in the
main checkout rather than in a worktree.
**Consequences:** `/ship` reads these first; missing files are bootstrapped, not invented.

## ADR-0002 Base is the default chain; Mantle is kept (2026-09-05)
**Status:** accepted
**Context:** Stax launched on Mantle, but Coinbase's tokenized stocks and liquidity on Base made
Base the better home. Dropping Mantle would have stranded existing users and deployments.
**Decision:** Base (8453) is the default; Mantle (5000) remains a selectable network. Every chain
is described by one `StaxChain` in `web/src/lib/chains/`, and code takes a chain, never a global.
**Consequences:** Adding a network is a config file plus the touchpoints that assumed a single
chain. Some features are Base-only (builder codes, gifts).

## ADR-0003 Wallet history from Zerion, no own indexer (2026-09-08)
**Status:** accepted
**Context:** Blockscout went down and Etherscan's free tier refuses Base, leaving history blank.
We considered storing every transaction in our own database with block numbers.
**Decision:** Read wallet history from Zerion, cached for a minute in Redis. No own indexer.
**Consequences:** Depends on Zerion's coverage and uptime. No backfill job to maintain.

## ADR-0004 Enter the BNB Hack by expanding Stax to BSC (2026-09-24)
**Status:** accepted
**Context:** The BNB Hack: Tokenized Stocks Edition (submissions lock 2026-10-11 12:00 UTC)
requires bStocks, Ondo or xStocks on BSC mainnet, built on the Binance Web3 API. Most of the
brief's suggested builds already exist in Stax.
**Decision:** Add BSC mainnet as a third chain rather than build a new product. Every existing
feature should work there, and the new layer uses what only the RWA Data API offers: on-chain
versus reference price, and market hours.
**Consequences:** Originality (25% of the score) has to come from the market-hours and price-gap
layer and the depth of the Agentic Wallet integration, not from the port. The public-repo
requirement means the repository must be made public or mirrored before submission.

## ADR-0005 BSC buys: build both execution paths, deploy the executor later (2026-09-24)
**Status:** accepted
**Context:** Binance's Trading API returns unsigned router calldata, which fits `StaxExecutor`'s
`Leg{router, swapData}` model, so the on-chain plan check can carry over to BSC. Deploying on BSC
mainnet is an on-chain write the human runs, and two facts about the calldata are still unverified.
**Decision:** Ship direct ERC-4337 smart-account swaps first, so a demo always exists. Build the
executor path behind `StaxChain.contracts.deployed` and turn it on once the human has deployed.
**Consequences:** Until the deploy, Vera's plan is checked off-chain only on BSC, and the product
copy must not claim otherwise there. Both paths must be kept working and tested.

## ADR-0006 USDT is the cash asset on BSC (2026-09-24)
**Status:** accepted
**Context:** Both BSC stablecoins are 18 decimals, so the code is the same either way. Only USDT was
proven in a live Binance quote, and it has the deepest BSC liquidity.
**Decision:** USDT `0x55d398326f99059fF775485246999027B3197955` is `chain.usdc` on BSC.
**Consequences:** Fixed at executor deploy time, because `usdc` is immutable in `StaxExecutor`. UI
copy must read the stablecoin symbol from the chain config instead of hardcoding "USDC".

## ADR-0007 No Stax fee on BSC during the hackathon (2026-09-24)
**Status:** accepted
**Context:** Binance's integrator fee works (proven live at 1%), but fee parameters lengthened test
routes to four hops, and the fee wallet may need activating first (`40469 REFERRER_NOT_ACTIVATED`).
**Decision:** No fee on either BSC path until after judging.
**Consequences:** Simpler demo routes. Revisit after 11 Oct 2026.

## ADR-0008 BNB Agent Studio is a core stream (2026-09-24)
**Status:** accepted
**Context:** Agentic Wallet is interactive-only (Binance-app confirmation per session), so it cannot
run unattended. BNB Agent Studio is the only Binance path that might sign unattended, and it carries
its own $2,000 special prize. The human chose to pursue it hard rather than as an afterthought.
**Decision:** Agent Studio becomes a core build stream. It starts with a testnet spike that proves
or disproves unattended signing, ERC-8183 tasks and x402 self-funding. What Vera does as a Studio
agent is decided after the spike, with evidence. A small Agentic Wallet "bring your own agent"
export is kept as well, because it is cheap and heavily weighted in scoring.
**Consequences:** Installing the Studio CLI (`@bnbagent/studio-cli`) is third-party code, accepted
with this decision. Mainnet runtime costs money, which is a human gate. The claim must match what
the spike proves; a Studio agent that needs a human to sign must not be presented as autonomous.

## ADR-0009 Constraints forced by the Binance API (2026-09-24)
**Status:** accepted
**Context:** Found live during research, not chosen.
**Decision:** Minimum $6 per leg, because Binance rejects quotes of $5 or less and Vera sizes
baskets to fit. xStocks is dropped, because it is not in the Binance Web3 API. BSC features bStock
and Ondo, curated to the 40 dual-listed tickers plus a few Ondo-only megacaps. Gifts stay Base-only.
**Consequences:** Small plans fail at planning rather than at execution. The cross-issuer price gap
becomes a headline feature.
