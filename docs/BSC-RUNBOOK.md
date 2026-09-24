# BSC runbook — the human-gated steps

Everything in this file is done by a person, in their own terminal or dashboard. Agents build and
verify; they never run these. Do them in order. Submissions lock **Sun 11 Oct 2026, 12:00 UTC**.

## 1. Production secrets in Vercel

Create a fresh Binance Web3 API key for production at the Binance Web3 developer portal. Do not
reuse the research key in `stax/local.env`. Then, from `stax/web`:

```bash
vercel env add WEB3_API_KEY production
vercel env add WEB3_SECRET_KEY production
vercel env add BSC_RPC_URL production              # a keyed BSC mainnet RPC (Alchemy, QuickNode, …)
vercel env add NEXT_PUBLIC_BSC_RPC_URL production  # a public-safe BSC RPC; this one reaches the browser
```

Add the same four to `preview` if you want a preview deploy to trade. Never run `vercel env pull`
into `web/.env.local`.

## 2. Pimlico sponsors chain 56

In the Pimlico dashboard (the project behind `PIMLICO_API_KEY`), confirm BNB Chain (56) is enabled
for bundling and sponsorship, and set a per-user or per-day spending cap on the sponsorship policy.
BSC trades are one user operation each (approve + swap), so a small cap covers the demo.

## 3. Deploy to production

Production deploys when `main` is pushed. The build runs `npm run db:migrate:deploy`, which applies
migration `web/drizzle/0010_*.sql` (it only widens the `chain` CHECK constraints to allow `bsc`).

```bash
cd "F:/Tools/stax v1/stax"          # the worktree shares this repo, so bnb-bsc is already here
git checkout main
git merge --no-ff bnb-bsc
cd web && npm run verify
cd .. && git push origin main
```

After the deploy, check the catalog answers:

```bash
curl -s "https://app.stax.best/api/rwa?chain=bsc" | jq '{tickers: (.tickers | length), buyable: ([.tickers[].venues[] | select(.buyable)] | length)}'
```

## 4. Fund the demo wallet and prove delivery

1. Sign in at app.stax.best, switch Settings → Network → **BNB Chain**, open Wallet → Receive and
   copy the smart account address.
2. Send about $20 of **USDT on BNB Chain (BEP-20)** to it. No BNB is needed; gas is sponsored.
3. During US market hours, buy **$6 of NVDA** from its stock page.
4. Confirm on bscscan.com that the NVDA token landed in the **smart account**. The swap calldata has
   no recipient field (`docs/BINANCE-WEB3.md` §10), and calldata alone could not rule out delivery
   to the bundler (`tx.origin`). If the tokens are anywhere else, stop and report it before any
   larger trade.
5. Then run a Vera plan (for example "$18 in big tech") and a sell.

## 5. Weekend check — Saturday 27 Sep

```bash
curl -s "https://app.stax.best/api/rwa?chain=bsc" | jq '[.tickers[].venues[] | select(.buyable)] | length'
```

Record the number and the UTC time in `tasks/bnb-dx-log.md`. If it is `0`, the demo video has to be
recorded on a weekday during US hours, and the submission copy should say that weekend screens show
the closed-market behaviour on purpose.

## 6. Optional: the BSC executor (ADR-0005)

Not needed for the demo: BSC trades go straight from the smart account. To deploy it anyway, put a
BNB-funded key in `contracts/.env` as `BSC_DEPLOYER_KEY`, plus `AGENT_SIGNER_ADDRESS`, then:

```bash
cd contracts
npm run check:bsc
BSC_ASSETS_JSON=/path/to/bsc-assets.json npm run deploy:bsc
BSC_ASSETS_JSON=/path/to/bsc-assets.json npm run enable:bsc
```

Then copy the printed addresses into `web/src/lib/chains/bsc.contracts.ts` and set `deployed: true`.
That also switches Autopilot on for BSC, so only do it after a successful direct-path trade.

## 7. Make the repository public

At least a day before the deadline. Scan the whole history first:

```bash
cd "F:/Tools/stax v1/stax"
gitleaks git --redact .
gh repo edit Magicianhax/stax --visibility public --accept-visibility-change-consequences
```

If gitleaks finds anything real, rotate that key before you publish, and consider publishing a fresh
mirror without the history instead.

## 8. Submission

- Record the demo video: a closed or paused market being refused, the price gap and both issuers
  on a stock page, a Vera plan sized to the $6 minimum, and a live buy.
- Write the developer-experience report yourself from `tasks/bnb-dx-log.md`. The organisers reject
  AI-written reports.
- Mint a judge invite link in the admin console (Invite codes) and put it in the submission form.
