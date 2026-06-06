import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { NextRequest } from "next/server";
import { AllocateRequestSchema, AllocationSchema } from "@/lib/allocation-schema";
import { ALL_ASSETS } from "@/lib/mantle";
import { displayFor } from "@/lib/displayAssets";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";

// Uses the Anthropic API + user input — never cache.
export const dynamic = "force-dynamic";

// Direct Anthropic model id (hyphens). Reads ANTHROPIC_API_KEY from env automatically.
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

// H-6: surface a missing key at module load (startup) rather than first request.
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[allocate] ANTHROPIC_API_KEY is not set — allocations will fail.");
}

// Only assets that are actually buyable in one tap. Assets flagged `coming`
// (listed for visibility but not yet routable, e.g. FBTC, USDY) are excluded so
// Vera never proposes something the executor can't place.
const BUYABLE = ALL_ASSETS.filter((a) => !displayFor(a.symbol).coming);
const ALLOWED_SYMBOLS = new Set(BUYABLE.map((a) => a.symbol));

function systemPrompt(): string {
  const universe = BUYABLE.map((a) => `${a.symbol} — ${a.name} [${a.tier}]`).join("; ");
  return [
    "You are Stax, an AI investing copilot on the Mantle blockchain.",
    "You turn a person's plain-language goal into a concrete portfolio of REAL tokenized assets they can buy in one tap.",
    "",
    "RULES:",
    `- Allocate ONLY across these available assets: ${universe}.`,
    "- Tiers: 'stock' = tokenized equities/ETFs (e.g. AAPL, TSLA, SPY, QQQ); 'safe' = yield-bearing dollar (sUSDe); 'crypto' = mETH / FBTC.",
    "- Weights MUST sum to exactly 100.",
    "- Diversify sensibly for the user's risk. Don't put everything in one volatile name unless they explicitly insist.",
    "- Map risk: cash/safe ~500-1500 bps; broad ETFs ~3000-4500; single tech stocks ~5000-7000; crypto ~7000-9000. riskScore is the blended portfolio risk.",
    "- Explain like the user has never invested before. Warm, concrete, zero jargon. Briefly note that sUSDe yield is variable and tokenized stocks track the real share price.",
    "- Writing style for ALL text fields (summary, rationale, each reason): short plain sentences. NEVER use em dashes ('—') or double hyphens ('--'); use commas, periods, colons, or parentheses instead. No marketing buzzwords (supercharge, seamless, unleash, world-class, etc.). Don't restate the goal back; get to the substance.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  // C-2: only a signed-in user can spend Anthropic tokens.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // M-5: cap AI calls per user (cost-amplification guard).
  const limit = rateLimit(`allocate:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: ReturnType<typeof AllocateRequestSchema.parse>;
  try {
    body = AllocateRequestSchema.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: AllocationSchema,
      system: systemPrompt(),
      prompt: [
        `Goal: ${body.goal}`,
        `Amount to invest: $${body.amountUsd}`,
        `Risk preference: ${body.riskTolerance ?? "infer from the goal"}`,
        "Build the allocation now.",
      ].join("\n"),
    });

    // Guardrails: only known symbols, weights normalized to 100.
    const filtered = object.allocations.filter((a) => ALLOWED_SYMBOLS.has(a.symbol));
    if (filtered.length === 0) {
      return badRequest("The copilot couldn't build a valid plan. Try rephrasing your goal.");
    }
    const total = filtered.reduce((s, a) => s + a.weightPct, 0);
    const normalized = filtered.map((a) => ({
      ...a,
      weightPct: total > 0 ? Math.round((a.weightPct / total) * 10000) / 100 : 0,
    }));

    return Response.json({
      ...object,
      allocations: normalized,
      amountUsd: body.amountUsd,
      model: MODEL,
    });
  } catch (err) {
    return serverError("allocate", err);
  }
}
