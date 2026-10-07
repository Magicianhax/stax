import { describe, expect, it } from "vitest";
import { ownsEmbeddedWallet } from "./privyWallets";

const mine = [{ id: "w_mine", address: "0xAbC0000000000000000000000000000000000001" }];

describe("ownsEmbeddedWallet", () => {
  it("accepts the user's own wallet id with its own address, case-insensitively", () => {
    expect(ownsEmbeddedWallet(mine, "w_mine", "0xabc0000000000000000000000000000000000001")).toBe(true);
  });
  it("refuses another user's wallet id paired with the caller's own address", () => {
    expect(ownsEmbeddedWallet(mine, "w_victim", "0xabc0000000000000000000000000000000000001")).toBe(false);
  });
  it("refuses the caller's wallet id paired with someone else's owner address", () => {
    expect(ownsEmbeddedWallet(mine, "w_mine", "0x0000000000000000000000000000000000000002")).toBe(false);
  });
  it("refuses everything for a user with no embedded wallet", () => {
    expect(ownsEmbeddedWallet([], "w_mine", "0xabc0000000000000000000000000000000000001")).toBe(false);
  });
});
