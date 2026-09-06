# Infra phase 1 — Postgres on Neon replaces Supabase

Goal: one durable store for everything the chain does not give us for free, on a free tier that does
not restrict us: **Neon Postgres** (project `rapid-haze-89910255`, region aws-us-east-1, db `neondb`)
via **Drizzle ORM** + **node-postgres**, deployed on Vercel. Supabase (`lib/server/supabase.ts`, the
`autopilots` / `autopilot_runs` tables, pg_cron) is removed. Scheduling stays on the existing
`/api/cron/autopilot` route, invoked by Vercel Cron.

## Connection (per the neon-postgres skill)

- `DATABASE_URL` = pooled (`-pooler`) for the app; `DATABASE_URL_UNPOOLED` = direct, for migrations.
  Both are in `web/.env.local`; set the same on Vercel.
- Driver: `pg` Pool, attached with `attachDatabasePool` from `@vercel/functions` (Fluid compute).
  One module `web/src/lib/db/client.ts` exports `db` (drizzle) and `pool`. Server-only.
- Migrations: drizzle-kit, SQL files in `web/drizzle/`, `npm run db:generate` / `db:migrate`
  (migrate uses `DATABASE_URL_UNPOOLED`). Never ad-hoc SQL in production.

## Schema — `web/src/lib/db/schema.ts`

| table | columns (all with `created_at timestamptz default now()`) | notes |
|---|---|---|
| `users` | `id text pk` (Privy user id), `email text`, `last_seen_at` | upserted on every authed request via `touchUser()` |
| `smart_accounts` | `user_id fk`, `chain text check in (base,mantle)`, `owner text`, `address text`, pk `(user_id, chain)` | the account an authed user trades from; lets `/api/swap-quote` verify `sender` |
| `autopilots` | `id uuid pk`, `user_id fk`, `chain text`, `wallet_id`, `owner`, `smart_account`, `goal`, `amount_usd numeric`, `cadence text`, `risk_ceiling_bps int`, `active bool`, `next_run_at timestamptz`, `last_run_at`, `runs int`, `claimed_at timestamptz` | port of the Supabase table, same fields `autopilotStore.ts` maps today |
| `autopilot_runs` | `id uuid pk`, `autopilot_id fk`, `user_id`, `chain`, `ran_at`, `status text (success,skipped,error)`, `amount_usd`, `assessed_risk_bps`, `reason`, `tx_hash`, `holdings jsonb` | audit log |
| `executor_events` | `chain`, `block_number bigint`, `tx_hash`, `log_index int`, `event text (RecommendationCommitted, AllocationExecuted, LegFilled)`, `plan_id`, `user text`, `data jsonb`, `timestamp timestamptz`, pk `(chain, tx_hash, log_index)` | the indexer's copy of the on-chain record |
| `index_cursors` | `chain pk`, `last_block bigint`, `updated_at` | where the indexer resumes |
| `price_snapshots` | `chain`, `symbol`, `price_usd numeric`, `source text`, `taken_at timestamptz`, pk `(chain, symbol, taken_at)` | written by `/api/prices` at most every 15 min per chain (write-through) |
| `baskets` | `id text pk` (8-char short id), `chain`, `owner_user_id nullable`, `name`, `tagline`, `icon`, `items jsonb`, `risk_score int`, `author text`, `source jsonb` | shared baskets by short link `/app?b=<id>` (the encoded `?basket=` link keeps working) |

Indexes: `autopilots (active, next_run_at)`, `executor_events (chain, user)`, `executor_events (chain, block_number)`,
`price_snapshots (chain, symbol, taken_at desc)`, `baskets (owner_user_id)`.

## Behaviour

- **Autopilot claim** (replaces pg_cron + `claim_due_autopilots()`): one atomic statement
  `UPDATE autopilots SET claimed_at = now() WHERE active AND next_run_at <= now() AND (claimed_at IS NULL OR claimed_at < now() - interval '30 minutes') RETURNING *`,
  then runs sequentially per chain as today; `claimed_at` cleared and `next_run_at` advanced on completion.
  `vercel.json` gets a cron for `/api/cron/autopilot` (hourly; Hobby plans allow daily only — set
  `0 9 * * *` there and note the cadence rule in the UI copy if we stay on Hobby). Cron auth = existing
  `AUTOPILOT_CRON_SECRET`.
- **Indexer** (`lib/server/indexer.ts`): `syncExecutorEvents(chain)` reads from `index_cursors`,
  fetches new logs (Etherscan V2 first, chunked RPC fallback — reuse `executorLogs.ts` fetchers),
  upserts `executor_events`, advances the cursor. Called (with a 60 s in-process throttle per chain)
  at the top of `/api/vera-record`, `/api/activity`, and the cron. All record/activity reads then
  come from Postgres (`getVeraRecordServer` / `getUserActivityServer` query the table), never from a
  full-range `getLogs`. Block timestamps stored, so relative times always work.
  As built (2026-09-06): the routes call `syncExecutorEvents(chain, { maxWaitMs: 8000 })` — after 8 s
  they serve what Postgres has while the sync finishes in the background (one in-flight promise per
  chain; the cron awaits fully). Without `ETHERSCAN_API_KEY` the RPC path scans ≤ 400 chunks of 9,999
  blocks per pass (2-wide, retry with backoff) over a `fallback()` transport: the chain RPC, then
  `mainnet.base.org` / `mantle-rpc.publicnode.com` (publicnode Base refuses historical getLogs; Mantle's
  own RPC rate-limits bursts). A cold Mantle backfill is two passes (~70 s + ~5 s). Block times come
  from Etherscan's `timeStamp` or a per-block `getBlock` cached in-process. The cursor upsert is
  monotonic (`greatest`). `LegFilled` is indexed too (`user` null; `plan_id` set).
- **Price snapshots** (`lib/server/priceSnapshots.ts`): `/api/prices` hands `recordPriceSnapshots`
  to `waitUntil` (never on the response path). One `taken_at` per batch; assets without a live price
  are skipped; the 15-min gate is an in-process last-write map seeded from `max(taken_at)` on cold start.
- **Smart accounts**: `useSmartAccount` posts `{chain, owner, address}` to `POST /api/me/account`
  once per session; `/api/swap-quote` requires `sender === recipient === stored address` for that
  user+chain (falls back to the current equality rule if no row yet, with a warning log).
- **Baskets**: `POST /api/baskets` (auth) saves a basket → `{id}`; `GET /api/baskets/:id` public;
  share links use `/app?b=<id>`; `LiteApp` resolves `?b=` (server fetch) and still decodes `?basket=`.
  Personal baskets stay in localStorage for now.
  As built: `POST` body `{chain, name, tagline?, icon, items: [{symbol, weightPct}], source?: {goal?}}`
  (zod shape + `sharedBasketFrom`, the same validator `decodeBasketLink` uses) → `201 {id, url:"/app?b=<id>"}`;
  30/min per user; `touchUser` first (FK). `GET` → `{basket}` re-validated on read (risk recomputed,
  author "shared"), `Cache-Control: public, s-maxage=300`; 400 on a malformed id, 404 when unknown
  or no longer investable. Share button: signed-in → `publish()` (POST, id memoised per contents this
  session) and the short link; signed out, demo, or any failure → the encoded link. Demo never fetches `?b=`.
- **Rate limiting**: keep `rateLimit.ts` in-memory (single region) — Upstash deferred.
- **Removal**: delete `lib/server/supabase.ts`, `@supabase/supabase-js`, `web/supabase/`, Supabase env
  keys from `.env.example`; README/MULTICHAIN updated. Data migration (done 2026-09-06): 2 autopilots + 100 run
  logs from the Mantle-era Supabase imported with `npm run db:import -- scripts/supabase-dump.json`
  (ids preserved, `chain = 'mantle'`, checksums matched the source).

## Private beta

Waitlist + gate + admin console per `docs/BETA.md`; tables `waitlist` and `waitlist_events` (migration
`0002_harsh_christian_walker`). Flag `NEXT_PUBLIC_PRIVATE_BETA=true` (server reads the same var via
`lib/beta.ts:isBetaOn()`); `ADMIN_USER_IDS` / `ADMIN_EMAILS` (server-only comma lists) name the admins;
`NEXT_PUBLIC_SITE_URL` prefixes referral links (default `https://www.stax.best`). Store:
`lib/server/waitlist.ts`; guards: `lib/server/admin.ts` (`requireApproved` on the five money routes,
`requireAdmin` on `/api/admin/beta`). Position is never stored — it is computed per query over waiting
rows as `rank() over (order by referrals desc, created_at asc)`, with referrals = rows whose
`referred_by` is this row's `ref_code` and status ≠ blocked. Admin listing is keyset-paginated on
`(sort_key, -referrals, created_at, id)`. Emails come from Privy linked accounts (cached in
`users.email`). `npm run db:smoke` covers a two-user join with a referral, positions, approve, access.

## Verification

`npm run db:migrate` against Neon succeeds; a smoke script inserts + claims an autopilot, upserts
events, reads the record; `tsc` 0; eslint baseline; dev server `/api/vera-record?chain=mantle` and
`?chain=base` return from Postgres after one sync (Mantle has 17 recommendations on-chain).
