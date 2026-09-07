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
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { chainKeyFromRequest } from "@/lib/server/chain";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { getAutopilot, upsertAutopilot, deleteAutopilot } from "@/lib/server/autopilotStore";
import { resolveAutopilotBasket } from "@/lib/server/autopilotPlan";
import { getOwnedBasket } from "@/lib/server/basketsStore";
import { touchUser } from "@/lib/server/users";
import { curatedBasketById, isBasketShortId, type Basket } from "@/lib/baskets";
import { getChain, type ChainKey } from "@/lib/chains";
import {
  AUTOPILOT_DEFAULTS,
  CADENCE_SECONDS,
  nextRunAfter,
  type AutopilotBasketSummary,
  type AutopilotConfig,
} from "@/lib/autopilot";

export const dynamic = "force-dynamic";

const addr = z.string().refine((a) => isAddress(a), "Invalid address.");
const ConfigInput = z.object({
  walletId: z.string().min(1), // Privy embedded-wallet id (server signs for this)
  owner: addr, // embedded EOA (smart-account owner)
  smartAccount: addr, // the AA address that holds funds + executes
  chain: z.enum(["base", "mantle"]).optional(), // ChainKey; defaults to the request chain
  goal: z.string().min(1).max(600),
  /** Curated id ("base:big-tech") or a stored basket's 8-char short id; null/absent = a Vera goal. */
  basketId: z.string().min(1).max(64).nullable().optional(),
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
      goal: body.goal,
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
