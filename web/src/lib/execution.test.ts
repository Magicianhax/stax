// Regression pin for the useInvest.ts finding (BNB Hack, Task 8, review fix): the direct
// smart-account path (ADR-0005) sends whatever `calls` a plan response carries straight through
// `sendSponsoredCalls` with no executor contract in between to whitelist the callee itself, so
// `assertExecCallsAreSafe` is the only thing standing between an untrusted response and blind
// execution. It must accept cash, a listed catalog asset, and the configured aggregator router,
// and refuse anything else before the client ever asks the wallet to sign.
import { describe, expect, it } from "vitest";
import { getChain } from "./chains";
import { assertExecCallsAreSafe, assertSavingsCallsAreSafe, type ExecCall } from "./execution";

const bsc = getChain("bsc");
const DEAD = "0x000000000000000000000000000000000000dEaD" as const;
const VENUS_VUSDT = "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as const;

describe("assertExecCallsAreSafe", () => {
  it("passes calls to cash, a catalog asset, and the aggregator router", () => {
    const asset = bsc.assets.all.find((a) => a.address)!;
    const calls: ExecCall[] = [
      { to: bsc.usdc.address, data: "0x1" },
      { to: bsc.routers.binance!, data: "0x2" },
      { to: asset.address!, data: "0x3" },
    ];
    expect(assertExecCallsAreSafe(bsc, calls)).toBe(calls);
  });

  it("refuses a call to an address that is neither cash, a catalog asset, nor the router", () => {
    const calls: ExecCall[] = [{ to: DEAD, data: "0x1" }];
    expect(() => assertExecCallsAreSafe(bsc, calls)).toThrow(/dEaD/i);
  });

  it("refuses the whole batch if even one call in it is unrecognized", () => {
    const calls: ExecCall[] = [
      { to: bsc.usdc.address, data: "0x1" },
      { to: DEAD, data: "0x2" },
    ];
    expect(() => assertExecCallsAreSafe(bsc, calls)).toThrow();
  });

  it("does not allow Venus's vUSDT market — that's Savings' own, narrower list", () => {
    const calls: ExecCall[] = [{ to: VENUS_VUSDT, data: "0x1" }];
    expect(() => assertExecCallsAreSafe(bsc, calls)).toThrow();
  });
});

// Pin for the wave 5b "money" stream: assertSavingsCallsAreSafe is the only thing standing
// between an untrusted /api/savings response and a blind wallet signature, same as
// assertExecCallsAreSafe above but scoped to Savings' own two addresses.
describe("assertSavingsCallsAreSafe", () => {
  it("passes calls to cash and the pinned Venus vUSDT contract", () => {
    const calls: ExecCall[] = [
      { to: bsc.usdc.address, data: "0x1" },
      { to: VENUS_VUSDT, data: "0x2" },
    ];
    expect(assertSavingsCallsAreSafe(bsc, calls)).toBe(calls);
  });

  it("refuses the trading router — a compromised savings response must not be able to swap", () => {
    const calls: ExecCall[] = [{ to: bsc.routers.binance!, data: "0x1" }];
    expect(() => assertSavingsCallsAreSafe(bsc, calls)).toThrow(/isn't cash or the pinned Venus contract/);
  });

  it("refuses a catalog asset address — a compromised savings response must not be able to buy stocks", () => {
    const asset = bsc.assets.all.find((a) => a.address)!;
    const calls: ExecCall[] = [{ to: asset.address!, data: "0x1" }];
    expect(() => assertSavingsCallsAreSafe(bsc, calls)).toThrow();
  });

  it("refuses an unrecognized address", () => {
    expect(() => assertSavingsCallsAreSafe(bsc, [{ to: DEAD, data: "0x1" }])).toThrow(/dEaD/i);
  });
});
