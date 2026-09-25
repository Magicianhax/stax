// /api/autopilot — manage the signed-in user's Autopilot config.
//   GET    → current config (or null) + a display summary of its basket, when it targets one
//   POST   → create/update (also resets the schedule)
//   DELETE → turn it off
// Authed (Privy session). The actual autonomous execution lives in the cron route.
// The config carries the chain it runs on: `chain` in the body wins, else the
// request's x-stax-chain header / ?chain= (Base default).
//
// Basket targets: `basketId` must be a basket the caller can see on that chain — a
// curated one (in code) or a stored one they saved themselves (baskets.owner_user_id).
// Anything else is a 400; the executor re-resolves it on every run.
//
// Rules (BSC only): an optional `rule` picks one of Autopilot's plain-English rule types
// (lib/rules.ts) instead of a plain goal/basket. It rides inside the stored `goal` column —
// `encodeRuleGoal` — because adding a real column needs a migration this effort doesn't have
// (see lib/rules.ts's header). `schedule_buy` is today's goal/basket behaviour and needs no
// `rule` at all; the other four are BSC-only (Base/Mantle Autopilot is unchanged).
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { chainKeyFromRequest } from "@/lib/server/chain";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError, jsonError } from "@/lib/server/respond";
import { getAutopilot, upsertAutopilot, deleteAutopilot } from "@/lib/server/autopilotStore";
import { resolveAutopilotBasket } from "@/lib/server/autopilotPlan";
import { getOwnedBasket } from "@/lib/server/basketsStore";
import { getSmartAccount, touchUser } from "@/lib/server/users";
import { curatedBasketById, isBasketShortId, type Basket } from "@/lib/baskets";
import { getChain, investableAssets, type ChainKey } from "@/lib/chains";
import { encodeRuleGoal, looksLikeEncodedRuleGoal, RULES_NEEDING_HOLDINGS, RULE_COMING_SOON_REASON, sanitizeRule, type Rule } from "@/lib/rules";
import {
  AUTOPILOT_DEFAULTS,
  CADENCE_SECONDS,
  nextRunAfter,
  type AutopilotBasketSummary,
  type AutopilotConfig,
} from "@/lib/autopilot";

export const dynamic = "force-dynamic";

const addr = z.string().refine((a) => isAddress(a), "Invalid address.");
const RuleInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule_buy") }),
  z.object({ type: z.literal("rebalance"), driftPct: z.number() }),
  z.object({ type: z.literal("buy_discount"), symbol: z.string().min(1).max(12), discountPct: z.number() }),
  z.object({ type: z.literal("safety_switch"), dropPct: z.number(), movePct: z.number() }),
  z.object({ type: z.literal("mix_keeper"), stockPct: z.number() }),
  z.object({ type: z.literal("earnings"), symbol: z.string().min(1).max(12), buyDaysBefore: z.number(), sellDaysAfter: z.number() }),
]);
const ConfigInput = z.object({
  walletId: z.string().min(1), // Privy embedded-wallet id (server signs for this)
  owner: addr, // embedded EOA (smart-account owner)
  smartAccount: addr, // the AA address that holds funds + executes
  chain: z.enum(["base", "mantle", "bsc"]).optional(), // ChainKey; defaults to the request chain
  goal: z.string().min(1).max(600),
  /** Curated id ("base:big-tech") or a stored basket's 8-char short id; null/absent = a Vera goal. */
  basketId: z.string().min(1).max(64).nullable().optional(),
  /** One of Autopilot's rule types (BSC only) — see file header. */
  rule: RuleInput.optional(),
  amountUsd: z.number().positive().max(100_000),
  cadence: z.enum(["daily", "weekly", "biweekly", "monthly"]),
  riskCeilingBps: z.number().int().min(0).max(10_000).optional(),
  maxPerPeriodUsd: z.number().positive().max(1_000_000).optional(),
});

function summarize(b: Basket): AutopilotBasketSummary {
  return {
    id: b.id,
    chain: b.chain,
    name: b.name,
    items: b.items.map((i) => ({ symbol: i.symbol, weightPct: i.weightPct })),
    riskScore: b.riskScore,
  };
}

/** A basket this user may point their autopilot at: curated on `chain`, or stored and owned by them. */
async function basketForUser(chain: ChainKey, id: string, userId: string): Promise<Basket | null> {
  const curated = curatedBasketById(chain, id);
  if (curated) return curated;
  if (!isBasketShortId(id)) return null;
  const owned = await getOwnedBasket(id, userId);
  if (!owned || !owned.ok || owned.basket.chain !== chain) return null;
  return owned.basket;
}

export async function GET(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const autopilot = await getAutopilot(user.userId);
  let basket: AutopilotBasketSummary | null = null;
  if (autopilot?.basketId) {
    try {
      const found = await resolveAutopilotBasket(getChain(autopilot.chain), autopilot.basketId);
      if (found.kind !== "missing" && found.basket) basket = summarize(found.basket);
    } catch {
      /* the summary is display-only; the config still returns */
    }
  }
  return Response.json({ autopilot, basket });
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  // Private beta: only approved users may spend (no-op while NEXT_PUBLIC_PRIVATE_BETA is off).
  const gate = await requireApproved(user);
  if (gate) return gate;
  const limit = await rateLimit(`autopilot:${user.userId}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof ConfigInput>;
  try {
    body = ConfigInput.parse(await req.json());
  } catch {
    return badRequest("Invalid autopilot settings.");
  }

  try {
    const chain = body.chain ?? chainKeyFromRequest(req);
    let basket: Basket | null = null;
    if (body.basketId) {
      basket = await basketForUser(chain, body.basketId, user.userId);
      if (!basket) return badRequest("That basket isn't available to invest in.");
    }

    // Rules other than "buy on a schedule" are BSC-only (file header). Nothing upstream of this
    // enforced it before — the type union alone can't, since `chain` is a separate field — so a
    // crafted or pasted request could set up e.g. a buy_discount rule on Base, which is already
    // `deployed: true` and would run for real today (review finding #3).
    if (body.rule && body.rule.type !== "schedule_buy" && chain !== "bsc") {
      return badRequest("Rules other than a schedule are only available on BNB Chain right now.");
    }
    // A plain `goal` is stored as-is and re-decoded on every run (lib/rules.ts's
    // encodeRuleGoal/decodeRoleGoal trick) — only THIS route may ever produce that encoding, via
    // `body.rule` below, so a hand-typed or pasted goal that already looks like one is refused
    // rather than silently accepted as a rule nobody validated.
    if (!body.rule && looksLikeEncodedRuleGoal(body.goal)) {
      return badRequest("That goal isn't valid.");
    }
    // Three of the five rule cards can't act yet — they need a live per-asset holdings read this
    // stream doesn't own (rulesEngine.ts's header) — so refuse saving one rather than let it sit
    // there skipping forever with no visible reason (review finding #5).
    if (body.rule && RULES_NEEDING_HOLDINGS.includes(body.rule.type)) {
      return badRequest(RULE_COMING_SOON_REASON);
    }

    // A rule other than "buy on a schedule" needs a symbol check the type union alone can't do
    // (buy_discount must name a stock actually tradeable on this chain), then rides inside the
    // stored goal text (see file header) sanitized to its bounded defaults.
    let goal = body.goal;
    if (body.rule && body.rule.type !== "schedule_buy") {
      if (body.rule.type === "buy_discount" || body.rule.type === "earnings") {
        const symbols = new Set(investableAssets(getChain(chain)).map((a) => a.symbol));
        if (!symbols.has(body.rule.symbol)) {
          return badRequest(`${body.rule.symbol} isn't tradeable on this chain right now.`);
        }
      }
      goal = encodeRuleGoal(sanitizeRule(body.rule as Rule), body.goal);
    }

    // The smart account Autopilot reads balances and holdings for must be the caller's own on
    // this chain (security review 2026-09-25), the same check /api/swap-quote makes.
    const registered = await getSmartAccount(user.userId, chain);
    if (registered && registered.address.toLowerCase() !== body.smartAccount.toLowerCase()) {
      return jsonError(403, "Autopilot must use your own account.");
    }

    // Clock at request time (allowed in a handler) — anchors the schedule.
    const now = Math.floor(Date.now() / 1000);
    const existing = await getAutopilot(user.userId);
    const cfg: AutopilotConfig = {
      id: existing?.id ?? `ap_${user.userId}`,
      userId: user.userId,
      walletId: body.walletId,
      owner: body.owner as `0x${string}`,
      smartAccount: body.smartAccount as `0x${string}`,
      chain,
      goal,
      basketId: basket?.id ?? null,
      amountUsd: body.amountUsd,
      cadence: body.cadence,
      riskCeilingBps: body.riskCeilingBps ?? AUTOPILOT_DEFAULTS.riskCeilingBps,
      maxPerPeriodUsd: body.maxPerPeriodUsd ?? body.amountUsd * AUTOPILOT_DEFAULTS.maxPerPeriodMultiplier,
      active: true,
      createdAt: existing?.createdAt ?? now,
      nextRunAt: nextRunAfter(now, body.cadence),
      runs: existing?.runs ?? 0,
      spentThisPeriod: 0,
    };
    await touchUser(user.userId); // autopilots.user_id references users.id
    return Response.json({
      autopilot: await upsertAutopilot(cfg),
      basket: basket ? summarize(basket) : null,
      cadenceSeconds: CADENCE_SECONDS[body.cadence],
    });
  } catch (err) {
    return serverError("autopilot", err);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  await deleteAutopilot(user.userId);
  return Response.json({ ok: true });
}
