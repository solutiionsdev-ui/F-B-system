import { num, toCsv } from "@/lib/csv";
import { rateToDb, toInputValue, type Currency, type Pair } from "@/lib/money";
import type { PeriodReport } from "./reports";

const usd = (cents: bigint) => num(toInputValue(cents, "USD"));
const amt = (minor: bigint, c: Currency) => num(toInputValue(minor, c));
const pair = (p: Pair) => [amt(p.USD, "USD"), amt(p.LBP, "LBP")];

export function slug(s: string) {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "report"
  );
}

export function reportFileName(r: PeriodReport, kind: string, ext: string) {
  const where = r.location ? `_${slug(r.location.name)}` : "";
  return `${slug(r.org.name)}${where}_${kind}_${r.filter.from}_${r.filter.to}.${ext}`;
}

/** One row per business day per location, in both currencies plus USD-equivalent. */
export function dailyCsv(r: PeriodReport): string {
  const header = [
    "date",
    "location",
    "status",
    "rate_lbp_per_usd",
    "cash_usd",
    "cash_lbp",
    "card_usd",
    "card_lbp",
    "toters_usd",
    "toters_lbp",
    "noknok_usd",
    "noknok_lbp",
    "other_usd",
    "other_lbp",
    "refunds_usd",
    "refunds_lbp",
    "discounts_usd",
    "discounts_lbp",
    "voids_usd",
    "voids_lbp",
    "vat_usd",
    "vat_lbp",
    "service_charge_usd",
    "service_charge_lbp",
    "collected_usd",
    "collected_lbp",
    "collected_usd_equiv",
    "expenses_usd",
    "expenses_lbp",
    "expenses_usd_equiv",
    "expected_cash_usd",
    "counted_cash_usd",
    "difference_usd",
    "expected_cash_lbp",
    "counted_cash_lbp",
    "difference_lbp",
    "difference_usd_equiv",
    "adjustments_usd_equiv",
    "difference_after_adjustments_usd_equiv",
    "difference_after_adjustments_usd",
    "difference_after_adjustments_lbp",
    "within_tolerance",
    "day_status",
    "difference_reason",
    "closing_note",
    "no_sales_reason",
    "closed_by",
  ];
  const rows = r.daily.map((d) => {
    const c = d.closing;
    return [
      d.date,
      d.locationName,
      d.status,
      num(rateToDb(d.rate)),
      ...pair(d.sales.byTender.cash),
      ...pair(d.sales.byTender.card),
      ...pair(d.sales.byTender.toters),
      ...pair(d.sales.byTender.noknok),
      ...pair(d.sales.byTender.other),
      ...pair(d.sales.refunds),
      ...pair(d.sales.discounts),
      ...pair(d.sales.voids),
      ...pair(d.sales.tax),
      ...pair(d.sales.serviceCharge),
      ...pair(d.sales.collected),
      usd(d.salesEq.collected),
      ...pair(d.expenses),
      usd(d.expensesEq),
      c ? amt(c.expected.USD, "USD") : null,
      c ? amt(c.counted.USD, "USD") : null,
      c ? amt(c.variance.USD, "USD") : null,
      c ? amt(c.expected.LBP, "LBP") : null,
      c ? amt(c.counted.LBP, "LBP") : null,
      c ? amt(c.variance.LBP, "LBP") : null,
      c ? usd(c.varianceEq) : null,
      usd(d.adjustmentsEq),
      d.varianceAfterEq == null ? null : usd(d.varianceAfterEq),
      d.varianceAfter ? amt(d.varianceAfter.USD, "USD") : null,
      d.varianceAfter ? amt(d.varianceAfter.LBP, "LBP") : null,
      c ? c.withinTolerance : null,
      d.dayStatus,
      c?.reason ?? null,
      c?.note ?? null,
      c?.noSalesReason ?? null,
      c?.closedByName ?? null,
    ];
  });
  return toCsv(header, rows);
}

/** Every expense in the period, including voided ones (marked), for the accountant's books. */
export function expensesCsv(r: PeriodReport): string {
  const header = [
    "date",
    "location",
    "category",
    "notes",
    "supplier",
    "receipt_no",
    "paid_from",
    "currency",
    "amount",
    "rate_lbp_per_usd",
    "usd_equiv",
    "status",
    "void_reason",
    "entered_by",
  ];
  const rows = r.expenses.map((e) => [
    e.date,
    e.locationName,
    e.category,
    e.description,
    e.vendor,
    e.receiptRef,
    e.paidFrom,
    e.currency,
    amt(e.amountMinor, e.currency),
    num(rateToDb(e.rate)),
    usd(e.eq),
    e.status,
    e.voidReason,
    e.enteredBy,
  ]);
  return toCsv(header, rows);
}
