// Stax Postgres schema (Neon) — the single source of truth for drizzle-kit.
// See docs/INFRA.md for the table contract. Edit here, then:
//   npm run db:generate   → writes SQL to web/drizzle/
//   npm run db:migrate    → applies it over DATABASE_URL_UNPOOLED
// Never hand-write SQL against production.
//
// Conventions: `chain` is the ChainKey ("base" | "mantle") enforced by a CHECK;
// money is `numeric` (read back as strings — callers Number() them); every
// table carries `created_at timestamptz default now()`.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const chainCheck = (name: string, col: AnyPgColumn) =>
  check(name, sql`${col} in ('base', 'mantle')`);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Privy users — one row per Privy user id, touched on every authed request. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  /**
   * Their X handle, lowercased and without its "@". Kept beside the email because an
   * account that signed in with X has no email at all, and without this there is nothing
   * left to call them by on a gift they sent.
   */
  xUsername: text("x_username"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

/** The ERC-4337 account an authed user trades from, per chain. */
export const smartAccounts = pgTable(
  "smart_accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    /** Embedded EOA that owns the smart account. */
    owner: text("owner").notNull(),
    /** The smart-account address (holds funds, executes). */
    address: text("address").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chain] }), chainCheck("smart_accounts_chain_check", t.chain)],
);

/** One autopilot per user: the delegated-investing config + run accounting. */
export const autopilots = pgTable(
  "autopilots",
  {
    /** App-assigned text id (legacy rows: `ap_<privy user id>`). */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: text("chain").notNull(),
    /** Privy embedded-wallet id (the server signs UserOps for this wallet). */
    walletId: text("wallet_id").notNull(),
    owner: text("owner").notNull(),
    smartAccount: text("smart_account").notNull(),
    /** Display string ("Invest in Big Tech" when a basket is set); Vera's prompt otherwise. */
    goal: text("goal").notNull(),
    /**
     * Set when the autopilot invests into a fixed basket instead of a Vera goal: a curated
     * basket id ("base:big-tech", see CURATED_BASKETS) or a stored `baskets.id`. No FK —
     * curated ids live in code, and a deleted stored basket pauses the autopilot at run time.
     */
    basketId: text("basket_id"),
    amountUsd: numeric("amount_usd").notNull(),
    cadence: text("cadence").notNull(),
    riskCeilingBps: integer("risk_ceiling_bps").notNull(),
    maxPerPeriodUsd: numeric("max_per_period_usd").notNull(),
    active: boolean("active").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    runs: integer("runs").notNull().default(0),
    spentThisPeriod: numeric("spent_this_period").notNull().default("0"),
    /** Set by the cron's atomic claim; cleared when the run finishes (or after 30 min). */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("autopilots_user_id_key").on(t.userId),
    index("autopilots_active_next_run_at_idx").on(t.active, t.nextRunAt),
    chainCheck("autopilots_chain_check", t.chain),
    check("autopilots_cadence_check", sql`${t.cadence} in ('daily', 'weekly', 'biweekly', 'monthly')`),
  ],
);

/** Append-only audit log of every autopilot run. */
export const autopilotRuns = pgTable(
  "autopilot_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null for runs imported from the Supabase era whose autopilot is gone. */
    autopilotId: text("autopilot_id").references(() => autopilots.id, { onDelete: "set null" }),
    userId: text("user_id").notNull(),
    chain: text("chain").notNull(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    amountUsd: numeric("amount_usd").notNull(),
    assessedRiskBps: integer("assessed_risk_bps"),
    reason: text("reason"),
    txHash: text("tx_hash"),
    /** What the run bought: [{ symbol, weightPct, amountUsd }]. */
    holdings: jsonb("holdings"),
    createdAt: createdAt(),
  },
  (t) => [
    index("autopilot_runs_user_ran_at_idx").on(t.userId, t.ranAt),
    chainCheck("autopilot_runs_chain_check", t.chain),
    check("autopilot_runs_status_check", sql`${t.status} in ('success', 'skipped', 'error')`),
  ],
);

/** The indexer's copy of the on-chain StaxExecutor record. */
export const executorEvents = pgTable(
  "executor_events",
  {
    chain: text("chain").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    event: text("event").notNull(),
    planId: text("plan_id"),
    user: text("user"),
    data: jsonb("data").notNull(),
    /** Block timestamp. */
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chain, t.txHash, t.logIndex] }),
    index("executor_events_chain_user_idx").on(t.chain, t.user),
    index("executor_events_chain_block_number_idx").on(t.chain, t.blockNumber),
    chainCheck("executor_events_chain_check", t.chain),
    check(
      "executor_events_event_check",
      sql`${t.event} in ('RecommendationCommitted', 'AllocationExecuted', 'LegFilled')`,
    ),
  ],
);

/** Where the indexer resumes, per chain. */
export const indexCursors = pgTable(
  "index_cursors",
  {
    chain: text("chain").primaryKey(),
    lastBlock: bigint("last_block", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [chainCheck("index_cursors_chain_check", t.chain)],
);

/** Write-through price cache, at most one row per (chain, symbol) per 15 min. */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    chain: text("chain").notNull(),
    symbol: text("symbol").notNull(),
    priceUsd: numeric("price_usd").notNull(),
    source: text("source").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chain, t.symbol, t.takenAt] }),
    index("price_snapshots_chain_symbol_taken_at_idx").on(t.chain, t.symbol, t.takenAt.desc()),
    chainCheck("price_snapshots_chain_check", t.chain),
  ],
);

/** Shared baskets by short link (/app?b=<id>). */
export const baskets = pgTable(
  "baskets",
  {
    /** 8-char short id. */
    id: text("id").primaryKey(),
    chain: text("chain").notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    tagline: text("tagline"),
    icon: text("icon"),
    items: jsonb("items").notNull(),
    riskScore: integer("risk_score"),
    author: text("author"),
    source: jsonb("source"),
    createdAt: createdAt(),
  },
  (t) => [index("baskets_owner_user_id_idx").on(t.ownerUserId), chainCheck("baskets_chain_check", t.chain)],
);

/**
 * Private-beta waitlist — one row per person (docs/BETA.md). `user_id` is the Privy user
 * once they sign in; admin-added rows (address/email only) get linked on first join.
 * Position is never stored: it is `rank() over (order by referrals desc, created_at asc)`
 * across waiting rows, where referrals = rows whose `referred_by` = this row's `ref_code`
 * and status != 'blocked' (see lib/server/waitlist.ts).
 */
export const waitlist = pgTable(
  "waitlist",
  {
    /** 12-char base62. */
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Primary wallet the person connected, lowercased. */
    address: text("address"),
    /** From Privy linked accounts when available, lowercased. */
    email: text("email"),
    status: text("status").notNull().default("waiting"),
    /** 8-char, lowercase + digits, no 0/o/1/l/i ambiguity. */
    refCode: text("ref_code").notNull(),
    /** Another row's `ref_code`, set once at join, never changed. */
    referredBy: text("referred_by"),
    /** 'beta-page' | 'admin' | 'import' | 'invite' */
    source: text("source"),
    /** The invite code that let this row skip the queue, if one did. */
    inviteCode: text("invite_code"),
    note: text("note"),
    createdAt: createdAt(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("waitlist_user_id_key").on(t.userId),
    uniqueIndex("waitlist_address_key").on(t.address),
    uniqueIndex("waitlist_ref_code_key").on(t.refCode),
    index("waitlist_status_created_at_idx").on(t.status, t.createdAt),
    index("waitlist_referred_by_idx").on(t.referredBy),
    index("waitlist_email_lower_idx").on(sql`lower(${t.email})`),
    check("waitlist_status_check", sql`${t.status} in ('waiting', 'approved', 'blocked')`),
  ],
);

/**
 * Invite codes: a code hands its holder a place in the beta without waiting.
 *
 * Uses are counted rather than a row being deleted, because a code that has been
 * handed out is a fact worth keeping after it is spent: the admin list should be
 * able to say what a code was for and who came in on it. `max_uses` of 1 is the
 * common case (a code per person); a larger number makes a code shareable with a
 * group, which is why redemption increments under a conditional update rather
 * than reading and writing back.
 */
export const inviteCodes = pgTable(
  "invite_codes",
  {
    /** The code itself, lowercase, from the unambiguous alphabet. */
    code: text("code").primaryKey(),
    /** What it was made for, in the admin's words: "seed round", "@jack". */
    label: text("label"),
    maxUses: integer("max_uses").notNull().default(1),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Privy user id of the admin who generated it. */
    createdBy: text("created_by").notNull(),
    /** Set when an admin turns a code off; a spent code is not disabled, it is spent. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invite_codes_created_at_idx").on(t.createdAt),
    check("invite_codes_max_uses_check", sql`${t.maxUses} >= 1`),
    check("invite_codes_uses_check", sql`${t.uses} >= 0`),
  ],
);

/** Append-only audit log of everything that happens to a waitlist row. */
export const waitlistEvents = pgTable(
  "waitlist_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    waitlistId: text("waitlist_id")
      .notNull()
      .references(() => waitlist.id, { onDelete: "cascade" }),
    /** 'system' | 'admin:<userId>' */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [
    index("waitlist_events_waitlist_id_idx").on(t.waitlistId),
    check(
      "waitlist_events_action_check",
      sql`${t.action} in ('joined', 'approved', 'blocked', 'unblocked', 'note', 'imported', 'invited')`,
    ),
  ],
);

/**
 * Relay deposit addresses for "Receive from any network" (docs/RECEIVE.md). One OPEN address
 * per `(user, chain, origin chain, origin currency)`: anything sent there is bridged to USDC on
 * `chain` for `recipient`. `refund_to` is an origin-chain address (the embedded EOA on EVM,
 * user-supplied elsewhere). `fee_usd` / `min_usd` are from the quote that minted the address,
 * so a repeat request never calls Relay.
 */
export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    /** 12-char base64url. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Destination chain ('base'). */
    chain: text("chain").notNull(),
    /** The smart account that receives USDC, lowercased. */
    recipient: text("recipient").notNull(),
    originChainId: integer("origin_chain_id").notNull(),
    /** Relay currency id on the origin chain (EVM addresses lowercased). */
    originCurrency: text("origin_currency").notNull(),
    originSymbol: text("origin_symbol").notNull(),
    /** 'evm' | 'svm' | 'tvm' | 'bvm' */
    originVm: text("origin_vm").notNull(),
    refundTo: text("refund_to").notNull(),
    /** The deposit address Relay handed out (unique: Relay mints one per request). */
    address: text("address").notNull(),
    requestId: text("request_id").notNull(),
    feeUsd: numeric("fee_usd").notNull(),
    minUsd: integer("min_usd").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deposit_addresses_address_key").on(t.address),
    uniqueIndex("deposit_addresses_user_route_key").on(t.userId, t.chain, t.originChainId, t.originCurrency),
    chainCheck("deposit_addresses_chain_check", t.chain),
    check("deposit_addresses_origin_vm_check", sql`${t.originVm} in ('evm', 'svm', 'tvm', 'bvm')`),
  ],
);

/**
 * "Gift a basket" (docs/GIFTS.md). One row per gift, keyed by the on-chain `giftId`
 * (0x + 32 random bytes) so the database row, the TimelockGift entry and the share
 * link are all the same id.
 *
 * A gift is addressed to an email or to an X username — `recipient_kind` says which,
 * and it is the ONLY thing that differs. Both kinds reuse the same two hash columns,
 * so the storage, the salt and the on-chain value are identical either way.
 *
 * The recipient's identity itself is never stored. `recipient_email_hash` is a
 * deterministic, peppered SHA-256 of the normalised address or handle — that is what
 * makes "gifts addressed to me" a single indexed lookup. `recipient_salt` is per gift
 * and produces the DIFFERENT hash that goes on-chain, so two gifts to the same person
 * are unlinkable to anyone reading Base. `recipient_email_masked` is the giver's own
 * display line: "a•••@gmail.com" for an email, and "@jack" in the clear for an X handle,
 * because a handle is public where an address is not. Shown back to the giver only,
 * never on the public share page.
 *
 * `status` walks pending → funded → (claimed | reclaimed); `failed` is a gift whose
 * parking transaction never landed.
 */
export const gifts = pgTable(
  "gifts",
  {
    /** The on-chain giftId: 0x + 64 hex chars. */
    id: text("id").primaryKey(),
    chain: text("chain").notNull(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The giver's smart account, lowercased — the only address that may reclaim. */
    fromAddress: text("from_address").notNull(),
    /** 'email' or 'x'. Decides which Privy identity a claim is checked against. */
    recipientKind: text("recipient_kind").notNull().default("email"),
    recipientEmailHash: text("recipient_email_hash").notNull(),
    recipientSalt: text("recipient_salt").notNull(),
    /** The giver's display line: "a•••@gmail.com" masked, or "@jack" in the clear. */
    recipientEmailMasked: text("recipient_email_masked").notNull(),
    /** Curated id ("base:big-tech") or a stored `baskets.id`. No FK, same reasoning as autopilots. */
    basketId: text("basket_id"),
    basketName: text("basket_name").notNull(),
    /**
     * The basket's holdings as they were on the day it was given: [{ symbol, weightPct }].
     * A snapshot rather than a lookup, because a gift can sit here for 25 years and a
     * shared basket can be deleted long before it opens. Public — weights are not secret.
     */
    holdings: jsonb("holdings"),
    amountUsd: numeric("amount_usd").notNull(),
    note: text("note"),
    unlockAt: timestamp("unlock_at", { withTimezone: true }).notNull(),
    reclaimAfter: timestamp("reclaim_after", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    createTxHash: text("create_tx_hash"),
    claimTxHash: text("claim_tx_hash"),
    claimedByUserId: text("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** What was parked: [{ symbol, address, amount }] with `amount` in raw token units. */
    tokens: jsonb("tokens"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("gifts_chain_recipient_email_hash_idx").on(t.chain, t.recipientEmailHash),
    index("gifts_chain_from_user_id_idx").on(t.chain, t.fromUserId),
    chainCheck("gifts_chain_check", t.chain),
    check(
      "gifts_status_check",
      sql`${t.status} in ('pending', 'funded', 'claimed', 'reclaimed', 'failed')`,
    ),
    check("gifts_recipient_kind_check", sql`${t.recipientKind} in ('email', 'x')`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type SmartAccount = typeof smartAccounts.$inferSelect;
export type NewSmartAccount = typeof smartAccounts.$inferInsert;
export type AutopilotRow = typeof autopilots.$inferSelect;
export type NewAutopilotRow = typeof autopilots.$inferInsert;
export type AutopilotRunRow = typeof autopilotRuns.$inferSelect;
export type NewAutopilotRunRow = typeof autopilotRuns.$inferInsert;
export type ExecutorEvent = typeof executorEvents.$inferSelect;
export type NewExecutorEvent = typeof executorEvents.$inferInsert;
export type IndexCursor = typeof indexCursors.$inferSelect;
export type NewIndexCursor = typeof indexCursors.$inferInsert;
export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type NewPriceSnapshot = typeof priceSnapshots.$inferInsert;
export type Basket = typeof baskets.$inferSelect;
export type NewBasket = typeof baskets.$inferInsert;
export type WaitlistRow = typeof waitlist.$inferSelect;
export type InviteCodeRow = typeof inviteCodes.$inferSelect;
export type NewWaitlistRow = typeof waitlist.$inferInsert;
export type WaitlistEvent = typeof waitlistEvents.$inferSelect;
export type NewWaitlistEvent = typeof waitlistEvents.$inferInsert;
export type DepositAddressRow = typeof depositAddresses.$inferSelect;
export type NewDepositAddressRow = typeof depositAddresses.$inferInsert;
export type GiftRow = typeof gifts.$inferSelect;
export type NewGiftRow = typeof gifts.$inferInsert;
