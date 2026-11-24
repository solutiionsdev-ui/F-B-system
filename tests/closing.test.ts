import { describe, expect, it } from "vitest";
import { computeExpected, reconcile, salesSummary, type SalesLineInput } from "@/lib/closing";
import { parseRate } from "@/lib/money";

const sales: SalesLineInput[] = [
  { lineType: "payment", tender: "cash", currency: "USD", amountMinor: 80000n },
  { lineType: "payment", tender: "cash", currency: "LBP", amountMinor: 20_000_000n },
  { lineType: "payment", tender: "card", currency: "USD", amountMinor: 50000n },
  { lineType: "refund", tender: "cash", currency: "USD", amountMinor: 1500n },
  { lineType: "discount", tender: null, currency: "USD", amountMinor: 3000n },
];

describe("computeExpected", () => {
  it("only counts cash that went through the drawer", () => {
    const b = computeExpected({
      openingFloat: { USD: 10000n, LBP: 2_000_000n },
      sales,
      expenses: [
        { paidFrom: "drawer", status: "active", currency: "LBP", amountMinor: 1_350_000n },
        { paidFrom: "drawer", status: "voided", currency: "LBP", amountMinor: 999_000n },
        { paidFrom: "bank", status: "active", currency: "USD", amountMinor: 18500n },
      ],
      movements: [
        { direction: "out", currency: "USD", amountMinor: 40000n },
        { direction: "in", currency: "LBP", amountMinor: 500_000n },
      ],
    });
    // USD: 100 + 800 - 15 - 400 = 485.00
    expect(b.expected.USD).toBe(48500n);
    // LBP: 2,000,000 + 20,000,000 - 1,350,000 + 500,000
    expect(b.expected.LBP).toBe(21_150_000n);
    expect(b.drawerExpenses.LBP).toBe(1_350_000n);
  });
});

describe("reconcile", () => {
  const rate = parseRate("89500");

  it("balances when the count matches", () => {
    const r = reconcile({ USD: 48500n, LBP: 21_150_000n }, { USD: 48500n, LBP: 21_150_000n }, rate, 100n);
    expect(r.variance).toEqual({ USD: 0n, LBP: 0n });
    expect(r.withinTolerance).toBe(true);
  });

  it("flags a shortage in LBP using the USD-equivalent", () => {
    const r = reconcile({ USD: 48500n, LBP: 21_150_000n }, { USD: 48500n, LBP: 19_360_000n }, rate, 100n);
    expect(r.variance.LBP).toBe(-1_790_000n);
    expect(r.varianceEquivCents).toBe(-2000n);
    expect(r.withinTolerance).toBe(false);
  });

  it("lets a USD overage and an LBP shortage offset within tolerance", () => {
    // +$5 in USD, -447,500 LBP (= -$5): nets to zero at the day's rate
    const r = reconcile({ USD: 0n, LBP: 447_500n }, { USD: 500n, LBP: 0n }, rate, 100n);
    expect(r.varianceEquivCents).toBe(0n);
    expect(r.withinTolerance).toBe(true);
  });
});

describe("salesSummary", () => {
  it("totals tenders and nets refunds", () => {
    const s = salesSummary(sales);
    expect(s.byTender.cash.USD).toBe(80000n);
    expect(s.byTender.card.USD).toBe(50000n);
    expect(s.collected.USD).toBe(128500n);
    expect(s.discounts.USD).toBe(3000n);
  });
});
