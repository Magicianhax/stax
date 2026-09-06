# Private beta — waitlist, referrals, gate, admin

Stax launches as a private beta. Anyone can join the list with the login they prefer (Privy:
email, Google, X, or their own wallet). The list is ordered by referrals; we approve people from
an admin console; only approved people can use `/app`. Everything lives in Neon Postgres.

Feature flag: `NEXT_PUBLIC_PRIVATE_BETA=true` (server reads the same var). When false or unset,
nothing is gated and the beta pages still work (so we can switch it off in one env change).

## Data — add to `web/src/lib/db/schema.ts` (agent `beta-server` owns the migration)

`waitlist`
| column | type | notes |
|---|---|---|
| `id` | text pk | 12-char base62 |
| `user_id` | text unique nullable, fk users(id) on delete set null | the Privy user once they sign in; admin-added rows may have none |
| `address` | text unique nullable (lowercased) | primary wallet the person connected (embedded or external) |
| `email` | text nullable (lowercased) | from Privy linked accounts when available |
| `status` | text check in ('waiting','approved','blocked') default 'waiting' | |
| `ref_code` | text unique | 8-char base62, uppercase-free (no 0/O/1/l ambiguity) |
| `referred_by` | text nullable | another row's `ref_code`, set once at join, never changed |
| `source` | text nullable | 'beta-page' \| 'admin' \| 'import' |
| `note` | text nullable | admin note |
| `created_at`, `approved_at`, `blocked_at` | timestamptz | |

Indexes: `(status, created_at)`, `(referred_by)`, `lower(email)`.

`waitlist_events` (audit): `id bigserial`, `waitlist_id`, `actor` ('system'|'admin:<userId>'), `action`
('joined','approved','blocked','unblocked','note','imported'), `meta jsonb`, `created_at`.

**Position** = rank of a waiting row ordered by `(referrals desc, created_at asc)` where
`referrals = count(waitlist where referred_by = row.ref_code and status != 'blocked')`. Computed
in SQL with a window function; never stored.

## API (all JSON; auth = Privy bearer via `verifyRequest`; chain header irrelevant)

- `POST /api/beta/join` (auth) body `{ address?: string, ref?: string }` → upserts the caller's row
  (by `user_id`; falls back to matching an admin-added row by `address` or `email` and links it),
  stores `referred_by` only if the row is new and `ref` is a valid code that is not the caller's
  own, pulls `email` from Privy linked accounts (`privy.users().get(userId)`; cache in `users.email`),
  logs `joined`. Returns `Access`. 60/min per user.
- `GET /api/me/access` (auth) → `Access = { beta: boolean, status: 'none'|'waiting'|'approved'|'blocked', position: number|null, waiting: number, refCode: string|null, referrals: number, referralUrl: string|null, joinedAt: number|null }`. `beta` = flag on. `status 'none'` = not on the list. Cache-Control no-store.
- `GET /api/beta/stats` (public, 60 s cache) → `{ waiting, approved, total }` for the landing/beta page.
- Admin (auth + `requireAdmin`): `GET /api/admin/beta?status=&q=&cursor=&limit=` → `{ rows: AdminRow[], next: cursor|null, stats }` where `AdminRow = { id, userId, address, email, status, refCode, referredBy, referrals, position, source, note, createdAt, approvedAt }` (search `q` over email/address/refCode/userId); `POST /api/admin/beta` body one of
  `{ action: 'approve'|'block'|'unblock', ids: string[] }`, `{ action: 'approveTop', n: number }` (top N waiting by position), `{ action: 'add', entries: [{ address?: string, email?: string, note?: string }] }` (creates approved rows with `source: 'admin'`), `{ action: 'note', id, note }` → `{ ok: true, changed: number }`. Every action logs a `waitlist_events` row with `actor = 'admin:<userId>'`.
- `requireAdmin(user)`: allowed when `user.userId ∈ ADMIN_USER_IDS` (comma list) OR the user's Privy email ∈ `ADMIN_EMAILS` (comma list, lowercased). 403 otherwise. Both env vars server-only.
- `requireApproved(user)` (server guard, only when the flag is on): 403 `{ error: "Stax is in private beta. You're on the list." , status }` unless the caller's row is `approved`. Applied in: `POST /api/invest-plan`, `POST /api/swap-quote`, `POST /api/autopilot`, `POST /api/autopilot/run`, `POST /api/allocate`. Read-only routes stay open.

## Pages

- `/beta` (site world, Persuade → Operate): hero line "Stax is in private beta." with one sub line;
  live counts from `/api/beta/stats`; the Privy login button ("Continue with email, Google, X or a
  wallet"); after login the page joins automatically (`POST /api/beta/join` with the connected
  address = embedded wallet or the external wallet, whichever Privy reports first, plus the stored
  `?ref=`), then shows the **card**: position ("#12 of 340"), referral link with copy, a share row
  (X post prefilled: "I'm on the list for Stax, real stocks in one sentence. Skip the line: <link>"),
  "each friend who joins moves you up", and their referral count. Approved users see "You're in" +
  "Open Stax". Blocked users see a calm "This account can't join right now." `?ref=CODE` on `/`
  or `/beta` is stored in `localStorage["stax.ref"]` until used.
- `/app` gate: in `LiteApp` (real mode only, never demo), after Privy auth resolve
  `GET /api/me/access`; while loading show the existing splash; if `beta && status !== 'approved'`
  render `BetaGateScreen` full-screen inside the app shell: the same card as `/beta` (position,
  link, share, count) in the app's design system, plus "Sign out". Approved → the app as today.
  `useBetaAccess()` hook (react-query, keyed by user id) is the single source; it refetches on
  window focus so an approval shows up without reload.
- `/admin/beta` (Operate, app design system on a desktop-width layout): requires Privy login and
  `requireAdmin` (the page calls `GET /api/admin/beta`; a 403 renders "Not for you"). Stats strip
  (waiting / approved / blocked / referrals total), search box, status filter tabs, table sorted by
  position (columns: #, person = email or short address, referrals, joined, status, referred by,
  actions), row actions approve/block/unblock/note, bulk select + approve, "Approve top N" and
  "Add addresses" sheets, CSV export of the current filter (client-side from loaded rows),
  keyboard: `/` focuses search, `a` approves selected. Optimistic updates, toasts, 44px targets.
- Landing: when the flag is on, the hero primary button becomes "Join the private beta" (→ `/beta`)
  and "Open Stax" moves to the secondary slot; nav "Open Stax" stays; footer gets "Beta".

## Ownership (parallel)

| agent | owns |
|---|---|
| `beta-server` | schema + migration, `lib/server/waitlist.ts`, `lib/server/admin.ts` (`requireAdmin`, `requireApproved`), `app/api/beta/**`, `app/api/me/access`, `app/api/admin/beta`, the `requireApproved` lines in the five routes, `lib/beta.ts` (shared `Access` type + `isBetaOn()`), `.env.example`, `docs/INFRA.md` note |
| `beta-public` | `app/beta/page.tsx` + components under `components/site/beta/*`, `hooks/useBetaAccess.ts`, `components/lite/screens/BetaGateScreen.tsx`, the gate wiring in `LiteApp.tsx`, ref capture, landing CTA + nav + footer changes (`sections/Hero.tsx`, `Nav.tsx`, `sections/Closing.tsx`) |
| `beta-admin` | `app/admin/beta/page.tsx` + `components/admin/*`, `hooks/useAdminBeta.ts` |

Contracts above are fixed; UI agents build against them before the server lands and verify once it does.
