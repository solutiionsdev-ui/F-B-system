import { describe, expect, it } from "vitest";
import {
  MoneyError,
  convert,
  countTotal,
  divRound,
  formatAmount,
  formatRate,
  parseAmount,
  parseOptionalAmount,
  parseRate,
  rateToDb,
  toInputValue,
  usdEquivalent,
} from "@/lib/money";

describe("parseAmount", () => {
  it("parses USD into cents", () => {
    expect(parseAmount("1,250.50", "USD")).toBe(125050n);
    expect(parseAmount("$12", "USD")).toBe(1200n);
    expect(parseAmount(".5", "USD")).toBe(50n);
    expect(parseAmount("1.5k", "USD")).toBe(150000n);
  });

  it("parses LBP as whole pounds, with k/m shorthand", () => {
    expect(parseAmount("4,500,000", "LBP")).toBe(4_500_000n);
    expect(parseAmount("4.5m", "LBP")).toBe(4_500_000n);
    expect(parseAmount("250k", "LBP")).toBe(250_000n);
    expect(parseAmount("89 500 LBP", "LBP")).toBe(89_500n);
  });

  it("rejects bad input instead of guessing", () => {
    expect(() => parseAmount("12.345", "USD")).toThrow(MoneyError);
    expect(() => parseAmount("1000.5", "LBP")).toThrow(/whole number/);
    expect(() => parseAmount("-5", "USD")).toThrow(MoneyError);
    expect(() => parseAmount("abc", "USD")).toThrow(MoneyError);
    expect(() => parseAmount("", "USD")).toThrow(MoneyError);
    expect(() => parseAmount("1.2.3", "USD")).toThrow(MoneyError);
  });

  it("treats empty optional fields as zero", () => {
    expect(parseOptionalAmount("", "LBP")).toBe(0n);
    expect(parseOptionalAmount(null, "USD")).toBe(0n);
  });
});

describe("formatting", () => {
  it("formats both currencies", () => {
    expect(formatAmount(125050n, "USD")).toBe("$1,250.50");
    expect(formatAmount(-300n, "USD")).toBe("−$3.00");
    expect(formatAmount(4_500_000n, "LBP")).toBe("LBP 4,500,000");
    expect(formatAmount(500n, "USD", { signed: true })).toBe("+$5.00");
    expect(formatAmount(0n, "USD", { signed: true })).toBe("$0.00");
  });

  it("round-trips input values", () => {
    expect(toInputValue(125005n, "USD")).toBe("1250.05");
    expect(parseAmount(toInputValue(125005n, "USD"), "USD")).toBe(125005n);
    expect(toInputValue(4_500_000n, "LBP")).toBe("4500000");
  });

  it("handles rates with up to 4 decimals", () => {
    expect(parseRate("89,500")).toBe(895_000_000n);
    expect(parseRate("89500.0000")).toBe(895_000_000n);
    expect(formatRate(parseRate("89500.25"))).toBe("89,500.25");
    expect(rateToDb(parseRate("89,500"))).toBe("89500.0000");
    expect(() => parseRate("0")).toThrow(MoneyError);
  });
});

describe("conversion", () => {
  const rate = parseRate("89500");

  it("converts exactly at the rate", () => {
    expect(convert(4_475_000n, "LBP", "USD", rate)).toBe(5000n); // $50.00
    expect(convert(5000n, "USD", "LBP", rate)).toBe(4_475_000n);
  });

  it("rounds half away from zero to the target unit", () => {
    // 1,000 LBP = 1.1173 cents -> 1 cent; 44,750 LBP = 50 cents exactly
    expect(convert(1_000n, "LBP", "USD", rate)).toBe(1n);
    expect(convert(44_750n, "LBP", "USD", rate)).toBe(50n);
    expect(convert(-1_790_000n, "LBP", "USD", rate)).toBe(-2000n);
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
  });

  it("does not drift with LBP amounts in the billions", () => {
    const big = 8_950_000_000n; // $100,000 at 89,500
    expect(convert(big, "LBP", "USD", rate)).toBe(10_000_000n);
  });

  it("combines a mixed USD + LBP pair", () => {
    expect(usdEquivalent({ USD: 1000n, LBP: 895_000n }, rate)).toBe(2000n);
  });
});

describe("countTotal", () => {
  it("adds notes and loose change", () => {
    expect(countTotal({ "100": 2, "20": 3 }, "USD", 75n)).toBe(26075n);
    expect(countTotal({ "100000": 10, "5000": 3 }, "LBP")).toBe(1_015_000n);
  });

  it("rejects notes that don't exist", () => {
    expect(() => countTotal({ "3": 1 }, "USD")).toThrow(MoneyError);
    expect(() => countTotal({ "100": 1.5 }, "USD")).toThrow(MoneyError);
  });
});
