// runGroup's retry loop, exercised through GET (review finding #4): a "skipped" run —
// `runAutopilot` returning `retryable: false` — must break the retry loop and release the
// config straight to its next natural slot, not retry 2 more times with 4s/12s sleeps and log
// 3 rows for a state that cannot change inside the same invocation (e.g. BSC while
// `chain.contracts.deployed` is false). Everything below is mocked; this test never touches a
// chain, Privy, or the DB, and never sleeps for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/server/indexer", () => ({ syncExecutorEvents: vi.fn().mockResolvedValue({ ok: true }) }));

const claimDueAutopilotsSpy = vi.fn();
const releaseAutopilotSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/server/autopilotStore", () => ({
  claimDueAutopilots: (...args: unknown[]) => claimDueAutopilotsSpy(...args),
  releaseAutopilot: (...args: unknown[]) => releaseAutopilotSpy(...args),
}));

const runAutopilotSpy = vi.fn();
vi.mock("@/lib/server/autopilotExecutor", () => ({ runAutopilot: (...args: unknown[]) => runAutopilotSpy(...args) }));

import { GET } from "./route";
import type { AutopilotConfig } from "@/lib/autopilot";

const NOW_S = Math.floor(Date.parse("2026-09-24T15:00:00.000Z") / 1000);

function cfg(overrides: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return {
    id: "ap_1",
    userId: "u1",
    walletId: "w1",
    owner: "0x1111111111111111111111111111111111111111",
    smartAccount: "0x2222222222222222222222222222222222222222",
    chain: "bsc",
    goal: "Grow my long-term plan",
    basketId: null,
    amountUsd: 25,
    cadence: "weekly",
    riskCeilingBps: 6000,
    maxPerPeriodUsd: 50,
    active: true,
    createdAt: NOW_S,
    nextRunAt: NOW_S,
    runs: 0,
    spentThisPeriod: 0,
    ...overrides,
  };
}

function req(): NextRequest {
  return new NextRequest("http://localhost/api/cron/autopilot", {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

beforeEach(() => {
  vi.stubEnv("AUTOPILOT_CRON_SECRET", "test-cron-secret");
  vi.stubEnv("CRON_SECRET", "");
  claimDueAutopilotsSpy.mockReset();
  releaseAutopilotSpy.mockReset().mockResolvedValue(undefined);
  runAutopilotSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/autopilot: a non-retryable skip", () => {
  it("runs once, never retries, and releases straight to the next slot", async () => {
    claimDueAutopilotsSpy.mockResolvedValue([cfg()]);
    runAutopilotSpy.mockResolvedValue({ ok: false, reason: "Stax is not deployed on BNB Chain yet.", retryable: false });

    const res = await GET(req());
    const body = await res.json();

    expect(runAutopilotSpy).toHaveBeenCalledTimes(1); // no retry attempts
    expect(body.results).toEqual([
      expect.objectContaining({ id: "ap_1", ok: false, attempts: 1, retryable: false }),
    ]);
    // Released to the config's own next cadence slot (a week out), not "soon" (15 minutes).
    const [, nextRunAt] = releaseAutopilotSpy.mock.calls[0] as [string, number];
    expect(nextRunAt).toBeGreaterThan(NOW_S + 60 * 60); // much later than the 15-minute retry-soon window
  });
});

describe("GET /api/cron/autopilot: a transient failure with no retryable flag", () => {
  it("still retries, unchanged from before this fix", async () => {
    vi.useFakeTimers();
    try {
      claimDueAutopilotsSpy.mockResolvedValue([cfg()]);
      runAutopilotSpy.mockResolvedValue({ ok: false, reason: "Submission failed." });

      const resPromise = GET(req());
      await vi.runAllTimersAsync(); // fast-forward the 4s/12s backoff sleeps
      const res = await resPromise;
      await res.json();

      expect(runAutopilotSpy).toHaveBeenCalledTimes(3); // 1 try + 2 retries
    } finally {
      vi.useRealTimers();
    }
  });
});
