// The retry policy is the difference between a bad minute and a skipped week,
// so the rule that decides "try again" is pinned here rather than assumed.
import { describe, expect, it } from "vitest";
import { HttpRequestError, RpcRequestError, TimeoutError } from "viem";
import { UnknownBundlerError, UserOperationExecutionError } from "viem/account-abstraction";
import { isPermanent, sendOutcomeUnknown } from "@/lib/autopilotRetry";

describe("autopilot retry policy", () => {
  it("does not retry a plan the person has to fix", () => {
    for (const reason of [
      "Basket risk above your ceiling",
      "Basket no longer exists",
      "Vera is not authorized for this account",
      "Insufficient USDC balance",
      "Not enough cash for this run",
      "Capped at $50.00 per period",
    ]) {
      expect(isPermanent(reason), reason).toBe(true);
    }
  });

  it("retries anything that might just be a bad moment", () => {
    for (const reason of [
      "Run reverted (tx 0xabc).",
      "HTTP request failed",
      "bundler timeout",
      "UserOperation reverted",
      undefined,
    ]) {
      expect(isPermanent(reason), String(reason)).toBe(false);
    }
  });
});

// The exact chain viem 2.x throws from sendUserOperation: the eth_sendUserOperation request's
// error, mapped by getBundlerError, wrapped in a UserOperationExecutionError.
const URL = "https://api.pimlico.io/v2/56/rpc";
const OP = {
  sender: "0x2222222222222222222222222222222222222222",
  nonce: BigInt(7),
  callData: "0x",
  callGasLimit: BigInt(1),
  preVerificationGas: BigInt(1),
  verificationGasLimit: BigInt(1),
  maxFeePerGas: BigInt(1),
  maxPriorityFeePerGas: BigInt(1),
  signature: "0x",
} as const;
const atSend = (cause: ConstructorParameters<typeof UnknownBundlerError>[0]["cause"]) =>
  new UserOperationExecutionError(new UnknownBundlerError({ cause }), OP);

describe("sendOutcomeUnknown: a send that may have reached the bundler is never a plain failure", () => {
  it("is unknown when eth_sendUserOperation timed out or lost its connection", () => {
    expect(sendOutcomeUnknown(atSend(new TimeoutError({ body: {}, url: URL })))).toBe(true);
    expect(sendOutcomeUnknown(atSend(new HttpRequestError({ url: URL, details: "socket hang up" })))).toBe(true);
    expect(sendOutcomeUnknown(atSend(new HttpRequestError({ url: URL, status: 504 })))).toBe(true);
  });

  it("is a plain failure when the bundler answered with a refusal (safe to retry)", () => {
    const refusal = new RpcRequestError({ body: {}, url: URL, error: { code: -32500, message: "AA21 didn't pay prefund" } });
    expect(sendOutcomeUnknown(atSend(refusal))).toBe(false);
    expect(sendOutcomeUnknown(atSend(new HttpRequestError({ url: URL, status: 429 })))).toBe(false);
  });

  it("is a plain failure when the timeout happened before the send (gas estimation, paymaster)", () => {
    expect(sendOutcomeUnknown(new TimeoutError({ body: {}, url: URL }))).toBe(false);
    expect(sendOutcomeUnknown(new Error("Privy down"))).toBe(false);
    expect(sendOutcomeUnknown(undefined)).toBe(false);
  });
});
