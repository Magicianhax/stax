import { z } from "zod";

/**
 * The typed allocation the AI agent must produce from a user's plain-language goal.
 * Used with the AI SDK's `generateObject` so the model is forced to return this shape.
 *
 * `venue`/`address` are BSC-only additions (Task 12): which issuer (bStock or Ondo) and which
 * on-chain address a leg will actually buy — the RWA catalog's `bestVenue` pick, resolved by
 * `buildAllocation` before the response goes out. Both are optional so Base/Mantle allocations
 * (and anything built before this wave, e.g. a saved basket's `basketToAllocation`) stay valid
 * without them. `/api/invest-plan` buys the issuer the plan showed while that issuer is still
 * buyable and one of the asset's own tokens, and falls back to the catalog's current best only
 * when it isn't (a market can close between building the plan and signing it).
 */
export const AllocationSchema = z.object({
  summary: z.string().describe("One short, friendly headline for the strategy (no jargon)."),
  rationale: z
    .string()
    .describe("2-4 plain-language sentences explaining the plan to someone who has never invested."),
  riskScore: z
    .number()
    .int()
    .min(0)
    .max(10000)
    .describe(
      "Assessed portfolio risk in basis points: cash/safe ~500-1500, broad ETFs ~3000-4500, single tech stocks ~5000-7000, crypto ~7000-9000.",
    ),
  allocations: z
    .array(
      z.object({
        symbol: z.string().describe("Asset ticker — MUST be one of the provided available assets."),
        weightPct: z.number().min(0).max(100).describe("Percent of the total investment in this asset."),
        reason: z.string().describe("One short, jargon-free reason this asset fits the goal."),
        venue: z.enum(["bstock", "ondo"]).optional().describe("BSC only: which issuer this leg will buy from."),
        address: z
          .string()
          .optional()
          .describe("BSC only: the on-chain address of that venue's token, for display."),
      }),
    )
    .min(1)
    .describe("The basket. Weights MUST sum to exactly 100."),
});

export type Allocation = z.infer<typeof AllocationSchema>;

/** Request body for POST /api/allocate */
export const AllocateRequestSchema = z.object({
  // Bounded length: caps Anthropic token spend and shrinks the prompt-injection
  // surface (a goal can't smuggle in a multi-KB instruction payload).
  goal: z.string().min(1, "Tell the AI what you want.").max(600, "Keep your goal under 600 characters."),
  amountUsd: z.number().positive().max(1_000_000, "That amount is too large."),
  riskTolerance: z.enum(["conservative", "balanced", "aggressive"]).optional(),
});

export type AllocateRequest = z.infer<typeof AllocateRequestSchema>;
