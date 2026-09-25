import type { NextRequest } from "next/server";
import { z } from "zod";
import { chainFromRequest } from "@/lib/server/chain";
import { requireApproved } from "@/lib/server/admin";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { parseRuleGoal, RuleRefusal } from "@/lib/server/rulesParser";

// Vera turns a plain-language Autopilot goal into one of the pickable rule types (item B of the
// rules stream): "buy NVDA when it's cheap" -> { type: "buy_discount", symbol: "NVDA", ... } with
// a plain explanation. Preview only — /api/autopilot's own POST is what actually saves a rule
// (the AutopilotScreen form can call either: type a goal and let Vera pick, or set the numbers
// on a card directly). Uses the Anthropic API — never cache.
export const dynamic = "force-dynamic";

const Body = z.object({
  goal: z.string().min(1, "Tell Vera what you want the rule to do.").max(300, "Keep it under 300 characters."),
});

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();
  const gate = await requireApproved(user);
  if (gate) return gate;

  const limit = await rateLimit(`autopilot-parse-rule:${user.userId}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const chain = chainFromRequest(req);
  try {
    const { rule, explanation } = await parseRuleGoal(chain, body.goal);
    return Response.json({ rule, explanation });
  } catch (err) {
    if (err instanceof RuleRefusal) return badRequest(err.message);
    return serverError("autopilot-parse-rule", err);
  }
}
