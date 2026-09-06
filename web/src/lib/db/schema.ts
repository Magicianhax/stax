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
    goal: text("goal").notNull(),
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
