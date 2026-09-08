// Invite codes are read aloud, written down and retyped, so the parser at the
// boundary has to forgive the things a person does to a code on the way.
import { describe, expect, it } from "vitest";
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode } from "./beta";

describe("normalizeInviteCode", () => {
  it("forgives case, spaces and the dashes people add", () => {
    expect(normalizeInviteCode("  ABC-234-XYZ ")).toBe("abc234xyz");
    expect(normalizeInviteCode("k m 7 p q r")).toBe("km7pqr");
  });

  it("refuses anything that could not be a code", () => {
    for (const bad of ["", "   ", "abc", "not a code!", "a".repeat(17), null, undefined]) {
      expect(normalizeInviteCode(bad), String(bad)).toBeNull();
    }
  });

  it("passes a freshly minted code through unchanged", () => {
    const code = INVITE_ALPHABET.slice(0, INVITE_CODE_LENGTH);
    expect(normalizeInviteCode(code)).toBe(code);
  });

  it("has no look-alike characters to confuse", () => {
    // 0/o and 1/l/i are the pairs people get wrong when copying by hand.
    for (const c of "01oli") expect(INVITE_ALPHABET).not.toContain(c);
  });
});
