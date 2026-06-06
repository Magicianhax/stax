import "server-only";

// Autopilot config store. MVP: in-memory, keyed by Privy userId — persists across
// requests within a single process (enough for local demo + a single serverless
// instance). For multi-instance prod, swap this module's body for Upstash Redis
// with the same function signatures; nothing else changes.
import type { AutopilotConfig } from "@/lib/autopilot";

const store = new Map<string, AutopilotConfig>();

export function getAutopilot(userId: string): AutopilotConfig | null {
  return store.get(userId) ?? null;
}

export function upsertAutopilot(cfg: AutopilotConfig): AutopilotConfig {
  store.set(cfg.userId, cfg);
  return cfg;
}

export function deleteAutopilot(userId: string): void {
  store.delete(userId);
}

/** All active autopilots whose nextRunAt has passed (for the cron). */
export function listDue(nowSeconds: number): AutopilotConfig[] {
  return [...store.values()].filter((c) => c.active && nowSeconds >= c.nextRunAt);
}

/** Persist a mutated config (after a run records nextRunAt / spentThisPeriod). */
export function recordRun(cfg: AutopilotConfig): void {
  store.set(cfg.userId, cfg);
}
