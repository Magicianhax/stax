import { describe, expect, it } from "vitest";
import {
  applyBackspace,
  applyKey,
  appendDigit,
  appendDot,
  exceedsMax,
  MAX_INT_DIGITS,
  sanitizeAmount,
  toAmountString,
} from "./useAmountKeypad";

/** Type a whole string of keys into a starting value, one press at a time. */
function type(start: string, keys: string, rules?: Parameters<typeof applyKey>[2]) {
  return [...keys].reduce((v, k) => applyKey(v, k as Parameters<typeof applyKey>[1], rules), start);
}

describe("digits append", () => {
  it("builds a number one key at a time", () => {
    expect(type("", "1")).toBe("1");
    expect(type("", "12")).toBe("12");
    expect(type("", "1234")).toBe("1234");
  });

  it("appends after a decimal point", () => {
    expect(type("", "12.5")).toBe("12.5");
    expect(type("", "12.50")).toBe("12.50");
  });

  it("ignores anything that is not a digit", () => {
    expect(appendDigit("12", "a")).toBe("12");
    expect(appendDigit("12", "")).toBe("12");
  });
});

describe("leading zero", () => {
  it("replaces a lone zero with the next digit", () => {
    expect(appendDigit("0", "5")).toBe("5");
    expect(type("", "05")).toBe("5");
  });

  it("keeps a lone zero when zero is pressed again", () => {
    expect(appendDigit("0", "0")).toBe("0");
    expect(type("", "000")).toBe("0");
  });

  it("keeps the zero once a decimal point follows it", () => {
    expect(appendDot("0")).toBe("0.");
    expect(type("", "0.")).toBe("0.");
    expect(type("", "0.5")).toBe("0.5");
    expect(type("", "0.05")).toBe("0.05");
  });

  it("starts a bare decimal point at nought point", () => {
    expect(appendDot("")).toBe("0.");
    expect(type("", ".5")).toBe("0.5");
  });

  it("does not collapse zeros that come after other digits", () => {
    expect(type("", "100")).toBe("100");
  });
});

describe("single decimal point", () => {
  it("refuses a second point", () => {
    expect(appendDot("12.5")).toBe("12.5");
    expect(type("", "12.5.7")).toBe("12.57");
  });

  it("refuses the point entirely when decimals is 0", () => {
    expect(appendDot("12", { decimals: 0 })).toBe("12");
    expect(type("", "12.5", { decimals: 0 })).toBe("125");
  });
});

describe("decimal place cap", () => {
  it("refuses a third place by default", () => {
    expect(type("", "1.23")).toBe("1.23");
    expect(appendDigit("1.23", "4")).toBe("1.23");
    expect(type("", "1.2345")).toBe("1.23");
  });

  it("honours a custom cap", () => {
    expect(type("", "1.2345", { decimals: 4 })).toBe("1.2345");
    expect(appendDigit("1.2345", "6", { decimals: 4 })).toBe("1.2345");
    expect(type("", "1.2", { decimals: 1 })).toBe("1.2");
    expect(appendDigit("1.2", "3", { decimals: 1 })).toBe("1.2");
  });
});

describe("max refusal", () => {
  it("refuses the keystroke instead of clamping", () => {
    expect(appendDigit("10", "0", { max: 100 })).toBe("100");
    expect(appendDigit("100", "0", { max: 100 })).toBe("100");
    expect(type("", "9999", { max: 100 })).toBe("99");
  });

  it("allows a value exactly on the ceiling, including its decimals", () => {
    expect(type("", "42.50", { max: 42.5 })).toBe("42.50");
    expect(appendDigit("42.5", "1", { max: 42.5 })).toBe("42.5");
  });

  it("lets a partial value through on the way to a legal one", () => {
    expect(exceedsMax("", 5)).toBe(false);
    expect(exceedsMax("0.", 5)).toBe(false);
    expect(exceedsMax("5.00", 5)).toBe(false);
    expect(exceedsMax("5.01", 5)).toBe(true);
  });

  it("does nothing without a max", () => {
    expect(type("", "9999")).toBe("9999");
    expect(exceedsMax("999999", undefined)).toBe(false);
  });

  it("still caps the integer digits so a stuck key cannot run away", () => {
    const long = type("", "1".repeat(MAX_INT_DIGITS + 4));
    expect(long).toBe("1".repeat(MAX_INT_DIGITS));
  });
});

describe("backspace", () => {
  it("drops one character at a time", () => {
    expect(applyBackspace("125")).toBe("12");
    expect(applyBackspace("12")).toBe("1");
    expect(applyBackspace("1")).toBe("");
    expect(applyBackspace("")).toBe("");
  });

  it("drops the decimal point like any other character", () => {
    expect(applyBackspace("12.")).toBe("12");
    expect(applyBackspace("12.5")).toBe("12.");
  });

  it("lets you retype after deleting into an empty field", () => {
    expect(type("125", "", undefined)).toBe("125"); // unmapped key is a no-op
    expect(applyKey(applyKey("125", "back"), "back")).toBe("1");
  });
});

describe("long-press clear", () => {
  it("empties the value whatever it held", () => {
    expect(applyKey("1234.56", "clear")).toBe("");
    expect(applyKey("0.", "clear")).toBe("");
    expect(applyKey("", "clear")).toBe("");
  });
});

describe("preset replacement", () => {
  it("renders a preset as a plain string with no trailing zeros", () => {
    expect(toAmountString(25)).toBe("25");
    expect(toAmountString(100)).toBe("100");
    expect(toAmountString(12.5)).toBe("12.5");
    expect(toAmountString(12.34)).toBe("12.34");
  });

  it("floors rather than rounds up, so Max never overshoots the balance", () => {
    expect(toAmountString(12.999)).toBe("12.99");
    expect(toAmountString(0.999, { decimals: 1 })).toBe("0.9");
  });

  it("reads an empty amount for nothing to spend", () => {
    expect(toAmountString(0)).toBe("");
    expect(toAmountString(Number.NaN)).toBe("");
  });

  it("replaces whatever was typed", () => {
    const typed = type("", "37.42");
    expect(typed).toBe("37.42");
    expect(sanitizeAmount(toAmountString(100))).toBe("100");
  });
});

describe("sanitizeAmount", () => {
  it("strips anything that is not a digit or a point", () => {
    expect(sanitizeAmount("$1,240.50")).toBe("1240.50");
    expect(sanitizeAmount("abc")).toBe("");
  });

  it("keeps only the first decimal point and caps the places", () => {
    expect(sanitizeAmount("1.2.3")).toBe("1.23");
    expect(sanitizeAmount("1.23456")).toBe("1.23");
    expect(sanitizeAmount("1.23456", { decimals: 4 })).toBe("1.2345");
    expect(sanitizeAmount("1.5", { decimals: 0 })).toBe("1");
  });

  it("normalises leading zeros and a bare point", () => {
    expect(sanitizeAmount("007")).toBe("7");
    expect(sanitizeAmount("00.5")).toBe("0.5");
    expect(sanitizeAmount(".5")).toBe("0.5");
    expect(sanitizeAmount("0")).toBe("0");
    expect(sanitizeAmount("0.")).toBe("0.");
  });
});
