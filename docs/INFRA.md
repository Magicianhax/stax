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
- **Rate limiting**: `rateLimit.ts` — Upstash sliding window when configured, else in-memory (see *Upstash Redis* below).
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

## Receive (Relay deposit addresses)

Contract in `docs/RECEIVE.md`; table `deposit_addresses` (migration `0003_skinny_screwball`), one
OPEN Relay address per `(user_id, chain, origin_chain_id, origin_currency)`, `address` unique. The row
also keeps `fee_usd` / `min_usd` from the quote that minted it, so a repeat request is a plain read.
Client: `lib/server/relay.ts` (`GET /chains` cached 1 h in-process, `POST /quote/v2` with
`useDepositAddress`, `GET /requests/v2?depositAddress=`; 10 s timeouts; `RelayRejected` for 4xx,
`RelayUnavailable` for the rest → 502). Store: `lib/server/depositAddresses.ts`. Env: `RELAY_API_URL`
(default `https://api.relay.link`) and optional `RELAY_API_KEY` (sent as `x-api-key`).

Verified 2026-09-06 against the public API without a key: the address is `steps[0].depositAddress`,
Relay's `user` must be an ORIGIN-chain address (we send `refundTo` as `user`), and each quote mints
a fresh address (hence the DB row). Solana deposit addresses answer `UNAUTHORIZED … missing an api
key`, so `curatedNetworks` drops Solana while `RELAY_API_KEY` is unset. `GET /requests/v2` is
deprecated (throttled from 2026-09-01, retired 2026-11-24); its successor `/requests/v3` requires a
key and renames `inTxs[].hash` → `txHash` (the parser already accepts both) — switch the path once
a key is in place. USD amounts come from `data.metadata.currencyIn.amountUsd`.
`npm run db:smoke` covers find-or-create idempotency, the own-address path, refund validation, and
the ownership check with Relay mocked.

## Upstash Redis — rate limits + response cache

Env: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Vercel → Storage → Upstash Redis, or the
upstash.com free tier; set both on Vercel and in `web/.env.local`). Unset = per-instance memory, so
nothing breaks locally or on a single instance; set = shared across every instance and region.
- **Rate limiting** (`lib/server/rateLimit.ts`): `await rateLimit(key, limit, windowMs)` → `{ok, retryAfter}`
  (async since 2026-09-07; every route awaits it). Upstash = `@upstash/ratelimit` sliding window, one
  `Ratelimit` per (limit, window), keys `stax:rl:<route>:<ip|userId>`, ephemeral in-process cache for
  already-blocked ids. Redis errors **fail open** (allow + one `console.warn` per minute), never a 500.
- **Cache** (`lib/server/cache.ts`): `cached(key, ttlSeconds, fn)` / `cacheDel(key)`, keys `stax:cache:<key>`,
  JSON with `EX`; bigint values throw (convert first); single-flight per key per process; in-memory Map
  fallback with the same TTL. Only public, non-user data: `/api/prices` (`prices:<chain>`, 15 s; the
  price-snapshot write-through runs only on a miss), `/api/market` history (`market:history:<chain>:<symbol>:<range>`,
  5 min for 1D/1W/1M, 30 min for 1Y/5Y) and the day summary (`market:summary:<chain>`, 60 s).
  `CACHE_DEBUG=1` logs `[cache] hit|miss|join <key>` at debug level.
- **Smoke**: `npm run upstash:smoke` (`scripts/upstash-smoke.ts`) hits the real Redis: 7 hits at 5/10 s → 5 ok +
  2 blocked with a sane `Retry-After`, cache miss/hit/TTL, single-flight, cached `null`, bigint rejection, del.

## Verification

`npm run db:migrate` against Neon succeeds; a smoke script inserts + claims an autopilot, upserts
events, reads the record; `tsc` 0; eslint baseline; dev server `/api/vera-record?chain=mantle` and
`?chain=base` return from Postgres after one sync (Mantle has 17 recommendations on-chain).
