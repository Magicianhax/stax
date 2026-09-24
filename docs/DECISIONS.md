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
