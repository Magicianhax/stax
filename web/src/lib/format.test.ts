// Quantities people have to read. The rule under test is that a holding is always
// a number you could type into a calculator, never an exponent.
import { describe, expect, it } from "vitest";
import { tokenQty } from "./format";

describe("tokenQty", () => {
  it("writes a small Bitcoin holding out in full", () => {
    // A third of a ten dollar gift, at eight decimals. This used to print "3.14e-5".
    expect(tokenQty(BigInt(3140), 8)).toBe("0.0000314");
  });

  it("never uses exponent notation, however small the balance", () => {
    for (const raw of [1, 9, 500, 31_400, 1_000_000]) {
      expect(tokenQty(BigInt(raw), 18)).not.toContain("e");
    }
  });

  it("keeps four significant figures below one, without trailing zeroes", () => {
    expect(tokenQty(BigInt("26500000000000000"), 18)).toBe("0.0265");
    expect(tokenQty(BigInt("15000000000000000"), 18)).toBe("0.015");
    expect(tokenQty(BigInt("1234500000000000"), 18)).toBe("0.001234");
  });

  it("keeps whole amounts whole", () => {
    expect(tokenQty(BigInt(20_000_000), 6)).toBe("20");
    expect(tokenQty(BigInt(1_500_000), 6)).toBe("1.5");
    expect(tokenQty(BigInt(0), 6)).toBe("0");
  });

  it("groups thousands", () => {
    expect(tokenQty(BigInt("1234567800"), 6)).toBe("1,234.57");
  });
});
