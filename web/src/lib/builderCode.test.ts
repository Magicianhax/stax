// The suffix has to be byte-for-byte right or the attribution is silently lost,
// so the anchor is Base's own worked example rather than our reading of it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { attributionSuffix, tagUserOps, type Encoder } from "./builderCode";

describe("attributionSuffix", () => {
  it("reproduces the string Base's dashboard generates for our code", () => {
    // Copied from dashboard.base.org → Builder Codes → Encoded String. This is the
    // authority: a write-up of the spec had the length byte first, which is not
    // what Base emits and not what a backwards parser could ever find.
    expect(attributionSuffix(["bc_wmmxuw6h"])).toBe(
      "0x62635f776d6d78757736680b0080218021802180218021802180218021",
    );
  });

  it("lays the bytes out as codes, length, schema, marker", () => {
    const suffix = attributionSuffix(["bc_wmmxuw6h"])!;
    expect(Buffer.from(suffix.slice(2, 24), "hex").toString("ascii")).toBe("bc_wmmxuw6h");
    expect(suffix.slice(24, 26)).toBe("0b"); // 11 characters
    expect(suffix.slice(26, 28)).toBe("00"); // schema 0
    expect(suffix.slice(28)).toBe("8021".repeat(8));
    // 11 + 1 + 1 + 16 bytes.
    expect((suffix.length - 2) / 2).toBe(29);
  });

  it("joins several codes with a comma", () => {
    const suffix = attributionSuffix(["stax", "relay"])!;
    expect(Buffer.from(suffix.slice(2, 22), "hex").toString("ascii")).toBe("stax,relay");
    expect(suffix.slice(22, 24)).toBe("0a");
  });

  it("returns null rather than throwing on anything it cannot encode", () => {
    expect(attributionSuffix([])).toBeNull();
    expect(attributionSuffix([""])).toBeNull();
    expect(attributionSuffix(["   "])).toBeNull();
    // A transaction must never fail over an attribution tag.
    expect(attributionSuffix(["cafè"])).toBeNull();
    expect(attributionSuffix(["a".repeat(256)])).toBeNull();
  });

  it("still encodes a code exactly at the one-byte limit", () => {
    const suffix = attributionSuffix(["a".repeat(255)])!;
    expect(suffix.slice(2 + 255 * 2, 2 + 255 * 2 + 2)).toBe("ff");
  });
});

describe("tagUserOps", () => {
  const CODE = "bc_test1234";
  const SUFFIX = attributionSuffix([CODE])!.slice(2);

  /** A stand-in for the smart account: all this feature touches is the encoder. */
  function stubAccount(encoded = "0xdeadbeef"): Encoder & { calls: unknown[] } {
    const account = {
      calls: [] as unknown[],
      encodeCalls: async function (this: unknown, calls: never) {
        (account.calls as unknown[]).push(calls);
        return encoded as `0x${string}`;
      },
    };
    return account;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends the suffix to whatever the account encoded", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", CODE);
    const account = stubAccount("0xdeadbeef");
    expect(tagUserOps(account, "base")).toBe(true);
    expect(await account.encodeCalls([] as never)).toBe(`0xdeadbeef${SUFFIX}`);
  });

  it("passes the calls through untouched", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", CODE);
    const account = stubAccount();
    tagUserOps(account, "base");
    const calls = [{ to: "0x1", data: "0x2" }];
    await account.encodeCalls(calls as never);
    expect(account.calls).toEqual([calls]);
  });

  it("leaves other chains alone", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", CODE);
    const account = stubAccount("0xdeadbeef");
    expect(tagUserOps(account, "mantle")).toBe(false);
    expect(await account.encodeCalls([] as never)).toBe("0xdeadbeef");
  });

  it("does nothing when no code is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", "");
    const account = stubAccount("0xdeadbeef");
    expect(tagUserOps(account, "base")).toBe(false);
    expect(await account.encodeCalls([] as never)).toBe("0xdeadbeef");
  });

  it("never throws on an account it cannot wrap", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_BUILDER_CODE", CODE);
    const frozen = Object.freeze(stubAccount("0xdeadbeef"));
    expect(tagUserOps(frozen, "base")).toBe(false);
    expect(await frozen.encodeCalls([] as never)).toBe("0xdeadbeef");
  });
});
