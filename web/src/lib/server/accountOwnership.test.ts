import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./chain", () => ({ serverClient: vi.fn() }));
vi.mock("./privyAuth", () => ({ fetchPrivyWallets: vi.fn() }));
vi.mock("./users", () => ({ getSmartAccount: vi.fn() }));

import { smartAccountOwnership, type OwnershipDeps } from "./accountOwnership";
import { getChain } from "@/lib/chains";

const bsc = getChain("bsc");
// The real user from 2026-10-09: an email wallet and a linked external wallet, two smart accounts.
const EMAIL_OWNER = "0x2aeabc4b7a2b85a0bc538b5478ae0a58ae299c3b";
const EMAIL_ACCOUNT = "0x01bF470AeC5d9c8586b283D8C952bAfCE71275d5";
const LINKED_OWNER = "0xc6d7709dd8ba53832bd578a88260f8b8e59fb4c7";
const LINKED_ACCOUNT = "0x1258599Ebfd9b6f722700780D9732264B0B9e4ac";
const STRANGER = "0x000000000000000000000000000000000000dEaD";

const deps = (registered: string | null, owners = [EMAIL_OWNER, LINKED_OWNER]): OwnershipDeps => ({
  registered: vi.fn(async () => registered),
  linkedOwners: vi.fn(async () => owners),
  accountFor: vi.fn(async (_chain, owner) => (owner.toLowerCase() === EMAIL_OWNER ? EMAIL_ACCOUNT : owner.toLowerCase() === LINKED_OWNER ? LINKED_ACCOUNT : STRANGER)),
});

describe("smartAccountOwnership", () => {
  it("is 'registered' for the account on file, without asking Privy", async () => {
    const d = deps(LINKED_ACCOUNT);
    expect(await smartAccountOwnership("u", bsc, LINKED_ACCOUNT.toLowerCase(), d)).toBe("registered");
    expect(d.linkedOwners).not.toHaveBeenCalled();
  });

  it("is 'linked' for the other wallet's account on the same login (the $25 Savings refused on 2026-10-09)", async () => {
    expect(await smartAccountOwnership("u", bsc, EMAIL_ACCOUNT, deps(LINKED_ACCOUNT))).toBe("linked");
  });

  it("is 'foreign' for an account no linked wallet owns", async () => {
    expect(await smartAccountOwnership("u", bsc, STRANGER, deps(LINKED_ACCOUNT))).toBe("foreign");
  });

  it("is 'unregistered' when nothing is on file yet", async () => {
    expect(await smartAccountOwnership("u", bsc, EMAIL_ACCOUNT, deps(null))).toBe("unregistered");
  });

  it("fails closed ('foreign') when the linked wallets can't be read", async () => {
    const d = deps(LINKED_ACCOUNT);
    d.linkedOwners = vi.fn(async () => {
      throw new Error("privy down");
    });
    expect(await smartAccountOwnership("u", bsc, EMAIL_ACCOUNT, d)).toBe("foreign");
  });
});
