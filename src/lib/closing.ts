// Expected-vs-counted cash for one business day, per currency.
//
// expected = opening float
//          + cash payments taken           (POS end-of-day report)
//          - cash refunds given back
//          - expenses paid out of the drawer
//          + cash put in (change top-ups)
//          - cash taken out (safe drops, owner withdrawals)
//
// Each currency is reconciled and judged on its own (spec 12.4): a USD overage
// can never hide an LBP shortage. The USD-equivalent of the combined
// difference is kept for reporting only. Any difference in either currency
// needs a written explanation; the per-currency allowance only decides whether
// the closed day counts as Balanced or Flagged.
import { CURRENCIES, type Currency, type Pair, usdEquivalent, zeroPair } from "./money";

export type SalesLineInput = {
  lineType: "payment" | "refund" | "discount" | "void" | "tax" | "service_charge";
  tender: "cash" | "card" | "other" | null;
  currency: Currency;
  amountMinor: bigint;
};
export type ExpenseInput = {
  paidFrom: "drawer" | "petty_cash" | "bank" | "owner";
  status: "active" | "voided";
  currency: Currency;
  amountMinor: bigint;
};
export type MovementInput = { direction: "in" | "out"; currency: Currency; amountMinor: bigint };

export type ExpectedBreakdown = {
  openingFloat: Pair;
  cashPayments: Pair;
  cashRefunds: Pair;
  drawerExpenses: Pair;
  movementsIn: Pair;
  movementsOut: Pair;
  expected: Pair;
};

export function computeExpected(input: {
  openingFloat: Pair;
  sales: SalesLineInput[];
  expenses: ExpenseInput[];
  movements: MovementInput[];
}): ExpectedBreakdown {
  const cashPayments = zeroPair();
  const cashRefunds = zeroPair();
  const drawerExpenses = zeroPair();
  const movementsIn = zeroPair();
  const movementsOut = zeroPair();

  for (const s of input.sales) {
    if (s.tender !== "cash") continue;
    if (s.lineType === "payment") cashPayments[s.currency] += s.amountMinor;
    else if (s.lineType === "refund") cashRefunds[s.currency] += s.amountMinor;
  }
  for (const e of input.expenses) {
    if (e.status === "active" && e.paidFrom === "drawer") drawerExpenses[e.currency] += e.amountMinor;
  }
  for (const m of input.movements) {
    (m.direction === "in" ? movementsIn : movementsOut)[m.currency] += m.amountMinor;
  }

  const expected = zeroPair();
  for (const c of CURRENCIES) {
    expected[c] =
      input.openingFloat[c] + cashPayments[c] - cashRefunds[c] - drawerExpenses[c] + movementsIn[c] - movementsOut[c];
  }
  return { openingFloat: input.openingFloat, cashPayments, cashRefunds, drawerExpenses, movementsIn, movementsOut, expected };
}

export type Reconciliation = {
  expected: Pair;
  counted: Pair;
  /** counted - expected, per currency. Negative means cash is missing. */
  variance: Pair;
  /** Both differences at the day's rate, for reporting only. Never used to judge the day. */
  varianceEquivCents: bigint;
  /** Zero difference in both currencies. */
  balanced: boolean;
  /** Each currency's difference is within that currency's allowance: closes as Balanced. */
  withinTolerance: boolean;
  /** Either currency has a difference: a reason and a written explanation are required. */
  needsExplanation: boolean;
};

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Whether every currency's amount is within that currency's allowance. */
export function withinAllowance(variance: Pair, tolerance: Pair): boolean {
  return CURRENCIES.every((c) => abs(variance[c]) <= tolerance[c]);
}

export function reconcile(expected: Pair, counted: Pair, rate: bigint, tolerance: Pair): Reconciliation {
  const variance: Pair = { USD: counted.USD - expected.USD, LBP: counted.LBP - expected.LBP };
  const balanced = variance.USD === 0n && variance.LBP === 0n;
  return {
    expected,
    counted,
    variance,
    varianceEquivCents: usdEquivalent(variance, rate),
    balanced,
    withinTolerance: withinAllowance(variance, tolerance),
    needsExplanation: !balanced,
  };
}

/** Totals for the day summary (all tenders), in each currency. */
export function salesSummary(sales: SalesLineInput[]) {
  const byTender = { cash: zeroPair(), card: zeroPair(), other: zeroPair() };
  const totals = {
    refunds: zeroPair(),
    discounts: zeroPair(),
    voids: zeroPair(),
    tax: zeroPair(),
    serviceCharge: zeroPair(),
  };
  for (const s of sales) {
    switch (s.lineType) {
      case "payment":
        byTender[s.tender ?? "other"][s.currency] += s.amountMinor;
        break;
      case "refund":
        totals.refunds[s.currency] += s.amountMinor;
        break;
      case "discount":
        totals.discounts[s.currency] += s.amountMinor;
        break;
      case "void":
        totals.voids[s.currency] += s.amountMinor;
        break;
      case "tax":
        totals.tax[s.currency] += s.amountMinor;
        break;
      case "service_charge":
        totals.serviceCharge[s.currency] += s.amountMinor;
        break;
    }
  }
  const collected = zeroPair();
  for (const c of CURRENCIES) {
    collected[c] = byTender.cash[c] + byTender.card[c] + byTender.other[c] - totals.refunds[c];
  }
  return { byTender, ...totals, collected };
}
