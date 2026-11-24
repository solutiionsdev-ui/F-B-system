// Period reports: the monthly management package, daily summaries and the
// cash-variance analysis. Framework-free so the screen, the CSV/PDF exports
// and the tests all use the same numbers.
//
// Every USD-equivalent is converted at the rate of the day it belongs to
// (expenses at the rate stored with the expense), then summed. Totals are
// never re-converted at a single rate, so a report reads the same next year.
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import {
  adjustments,
  businessDays,
  cashMovements,
  dayClosings,
  exchangeRates,
  expenseCategories,
  expenses,
  locations,
  organizations,
  salesLines,
  users,
  type Currency,
  type PaidFrom,
  type Role,
  type VarianceReason,
} from "@/db/schema";
import { salesSummary } from "@/lib/closing";
import { convert, parseRate, usdEquivalent, zeroPair, type Pair } from "@/lib/money";
import { UserError } from "./operations";

export const REPORT_ROLES: Role[] = ["owner", "accountant"];
const MAX_DAYS = 366;

export type ReportFilter = { from: string; to: string; locationId?: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function validateFilter(f: ReportFilter): ReportFilter {
  if (!ISO.test(f.from) || !ISO.test(f.to) || Number.isNaN(Date.parse(f.from)) || Number.isNaN(Date.parse(f.to))) {
    throw new UserError("Pick a valid start and end date.");
  }
  if (f.to < f.from) throw new UserError("The end date is before the start date.");
  if (daysBetween(f.from, f.to) > MAX_DAYS) throw new UserError("Reports can cover at most one year.");
  if (f.locationId && !UUID.test(f.locationId)) throw new UserError("Pick a valid location.");
  return { from: f.from, to: f.to, locationId: f.locationId || null };
}

/** The same number of days immediately before the period, for comparison. */
export function previousPeriod(f: ReportFilter): ReportFilter {
  const len = daysBetween(f.from, f.to);
  return { from: shiftDate(f.from, -len), to: shiftDate(f.from, -1), locationId: f.locationId };
}

type SalesBlock = ReturnType<typeof salesSummary>;
const SALES_KEYS = ["refunds", "discounts", "voids", "tax", "serviceCharge", "collected"] as const;
const TENDERS = ["cash", "card", "other"] as const;

function emptySales(): SalesBlock {
  return {
    byTender: { cash: zeroPair(), card: zeroPair(), other: zeroPair() },
    refunds: zeroPair(),
    discounts: zeroPair(),
    voids: zeroPair(),
    tax: zeroPair(),
    serviceCharge: zeroPair(),
    collected: zeroPair(),
  };
}

/** Converts every pair in a sales block to USD cents at one rate. */
function salesEq(s: SalesBlock, rate: bigint) {
  return {
    cash: usdEquivalent(s.byTender.cash, rate),
    card: usdEquivalent(s.byTender.card, rate),
    other: usdEquivalent(s.byTender.other, rate),
    refunds: usdEquivalent(s.refunds, rate),
    discounts: usdEquivalent(s.discounts, rate),
    voids: usdEquivalent(s.voids, rate),
    tax: usdEquivalent(s.tax, rate),
    serviceCharge: usdEquivalent(s.serviceCharge, rate),
    collected: usdEquivalent(s.collected, rate),
  };
}
type SalesEq = ReturnType<typeof salesEq>;
const emptySalesEq = (): SalesEq => salesEq(emptySales(), 1n);

function addPair(into: Pair, p: Pair) {
  into.USD += p.USD;
  into.LBP += p.LBP;
}
function addSales(into: SalesBlock, s: SalesBlock) {
  for (const t of TENDERS) addPair(into.byTender[t], s.byTender[t]);
  for (const k of SALES_KEYS) addPair(into[k], s[k]);
}
function addSalesEq(into: SalesEq, s: SalesEq) {
  for (const k of Object.keys(into) as (keyof SalesEq)[]) into[k] += s[k];
}

export type DailyRow = {
  dayId: string;
  date: string;
  locationId: string;
  locationName: string;
  status: "open" | "closed";
  rate: bigint;
  sales: SalesBlock;
  salesEq: SalesEq;
  hasSales: boolean;
  expenses: Pair;
  expensesEq: bigint;
  drawerOut: Pair;
  closing: {
    expected: Pair;
    counted: Pair;
    variance: Pair;
    varianceEq: bigint;
    withinTolerance: boolean;
    reason: VarianceReason | null;
    note: string | null;
    closedByName: string | null;
    closedAt: Date;
  } | null;
  adjustments: Pair;
  adjustmentsEq: bigint;
  /** Difference after corrections; null while the day is open. */
  varianceAfterEq: bigint | null;
};

export type ExpenseRow = {
  id: string;
  date: string;
  locationId: string;
  locationName: string;
  category: string;
  description: string;
  vendor: string | null;
  paidFrom: PaidFrom;
  currency: Currency;
  amountMinor: bigint;
  rate: bigint;
  eq: bigint;
  status: "active" | "voided";
  voidReason: string | null;
  enteredBy: string | null;
};

export type PeriodReport = Awaited<ReturnType<typeof computePeriodReport>>;

export async function getPeriodReport(db: DB, scope: TenantScope, filter: ReportFilter) {
  if (!REPORT_ROLES.includes(scope.role)) throw new UserError("Reports are available to owners and accountants.");
  return computePeriodReport(db, scope, filter);
}

/**
 * The report itself, without the role check. Only for server code that shows
 * a small slice of it to every role (the Today page's headline figures).
 */
export async function computePeriodReport(db: DB, scope: TenantScope, filter: ReportFilter) {
  const f = validateFilter(filter);

  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const locs = await tx.select().from(locations).orderBy(asc(locations.name));
    const location = f.locationId ? locs.find((l) => l.id === f.locationId) : null;
    if (f.locationId && !location) throw new UserError("That location doesn't exist.");

    const closer = alias(users, "closer");
    const dayRows = await tx
      .select({
        day: businessDays,
        locationName: locations.name,
        rate: exchangeRates.lbpPerUsd,
        closing: dayClosings,
        closedByName: closer.name,
      })
      .from(businessDays)
      .innerJoin(locations, eq(locations.id, businessDays.locationId))
      .innerJoin(exchangeRates, eq(exchangeRates.id, businessDays.rateId))
      .leftJoin(dayClosings, eq(dayClosings.businessDayId, businessDays.id))
      .leftJoin(closer, eq(closer.id, businessDays.closedBy))
      .where(
        and(
          gte(businessDays.businessDate, f.from),
          lte(businessDays.businessDate, f.to),
          f.locationId ? eq(businessDays.locationId, f.locationId) : undefined,
        ),
      )
      .orderBy(asc(businessDays.businessDate), asc(locations.name));

    const dayIds = dayRows.map((r) => r.day.id);
    const lines = dayIds.length ? await tx.select().from(salesLines).where(inArray(salesLines.businessDayId, dayIds)) : [];
    const adjs = dayIds.length ? await tx.select().from(adjustments).where(inArray(adjustments.businessDayId, dayIds)) : [];
    const moves = dayIds.length
      ? await tx.select().from(cashMovements).where(inArray(cashMovements.businessDayId, dayIds))
      : [];

    const entered = alias(users, "entered");
    const expRows = await tx
      .select({
        e: expenses,
        category: expenseCategories.name,
        locationName: locations.name,
        rate: exchangeRates.lbpPerUsd,
        enteredBy: entered.name,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .innerJoin(locations, eq(locations.id, expenses.locationId))
      .innerJoin(exchangeRates, eq(exchangeRates.id, expenses.rateId))
      .leftJoin(entered, eq(entered.id, expenses.createdBy))
      .where(
        and(
          gte(expenses.expenseDate, f.from),
          lte(expenses.expenseDate, f.to),
          f.locationId ? eq(expenses.locationId, f.locationId) : undefined,
        ),
      )
      .orderBy(asc(expenses.expenseDate), asc(expenses.createdAt));

    const expenseList: ExpenseRow[] = expRows.map((r) => {
      const rate = parseRate(r.rate);
      return {
        id: r.e.id,
        date: r.e.expenseDate,
        locationId: r.e.locationId,
        locationName: r.locationName,
        category: r.category,
        description: r.e.description,
        vendor: r.e.vendor,
        paidFrom: r.e.paidFrom,
        currency: r.e.currency,
        amountMinor: r.e.amountMinor,
        rate,
        eq: convert(r.e.amountMinor, r.e.currency, "USD", rate),
        status: r.e.status,
        voidReason: r.e.voidReason,
        enteredBy: r.enteredBy,
      };
    });
    const activeExpenses = expenseList.filter((e) => e.status === "active");

    // ---- daily rows
    const linesByDay = Map.groupBy(lines, (l) => l.businessDayId);
    const adjByDay = Map.groupBy(adjs, (a) => a.businessDayId);
    const movesByDay = Map.groupBy(moves, (m) => m.businessDayId);
    const expByDay = Map.groupBy(
      expRows.filter((r) => r.e.status === "active" && r.e.businessDayId),
      (r) => r.e.businessDayId!,
    );

    const daily: DailyRow[] = dayRows.map((r) => {
      const rate = parseRate(r.rate);
      const dayLines = linesByDay.get(r.day.id) ?? [];
      const sales = salesSummary(dayLines);
      const exp = zeroPair();
      let expEq = 0n;
      for (const x of expByDay.get(r.day.id) ?? []) {
        exp[x.e.currency] += x.e.amountMinor;
        expEq += convert(x.e.amountMinor, x.e.currency, "USD", parseRate(x.rate));
      }
      const drawerOut = zeroPair();
      for (const m of movesByDay.get(r.day.id) ?? []) if (m.direction === "out") drawerOut[m.currency] += m.amountMinor;
      const adj = zeroPair();
      for (const a of adjByDay.get(r.day.id) ?? []) adj[a.currency] += a.amountMinor;
      const adjEq = usdEquivalent(adj, rate);
      const c = r.closing;
      return {
        dayId: r.day.id,
        date: r.day.businessDate,
        locationId: r.day.locationId,
        locationName: r.locationName,
        status: r.day.status,
        rate,
        sales,
        salesEq: salesEq(sales, rate),
        hasSales: dayLines.length > 0,
        expenses: exp,
        expensesEq: expEq,
        drawerOut,
        closing: c
          ? {
              expected: { USD: c.expectedUsd, LBP: c.expectedLbp },
              counted: { USD: c.countedUsd, LBP: c.countedLbp },
              variance: { USD: c.varianceUsd, LBP: c.varianceLbp },
              varianceEq: c.varianceEquivCents,
              withinTolerance: c.withinTolerance,
              reason: c.varianceReason,
              note: c.note,
              closedByName: r.closedByName,
              closedAt: c.closedAt,
            }
          : null,
        adjustments: adj,
        adjustmentsEq: adjEq,
        varianceAfterEq: c ? c.varianceEquivCents + adjEq : null,
      };
    });

    // ---- totals
    const sales = emptySales();
    const salesTotalEq = emptySalesEq();
    for (const d of daily) {
      addSales(sales, d.sales);
      addSalesEq(salesTotalEq, d.salesEq);
    }
    const expenseTotal = zeroPair();
    let expenseTotalEq = 0n;
    const byCategory = new Map<string, { name: string; pair: Pair; eq: bigint; count: number }>();
    const byPaidFrom = new Map<PaidFrom, { pair: Pair; eq: bigint }>();
    for (const e of activeExpenses) {
      expenseTotal[e.currency] += e.amountMinor;
      expenseTotalEq += e.eq;
      const cat = byCategory.get(e.category) ?? { name: e.category, pair: zeroPair(), eq: 0n, count: 0 };
      cat.pair[e.currency] += e.amountMinor;
      cat.eq += e.eq;
      cat.count += 1;
      byCategory.set(e.category, cat);
      const pf = byPaidFrom.get(e.paidFrom) ?? { pair: zeroPair(), eq: 0n };
      pf.pair[e.currency] += e.amountMinor;
      pf.eq += e.eq;
      byPaidFrom.set(e.paidFrom, pf);
    }

    // ---- cash control
    const closed = daily.filter((d) => d.closing);
    const reasons = new Map<VarianceReason, { count: number; eq: bigint }>();
    let shortEq = 0n;
    let overEq = 0n;
    let adjustmentsEq = 0n;
    for (const d of closed) {
      const v = d.closing!.varianceEq;
      if (v < 0n) shortEq += v;
      else overEq += v;
      adjustmentsEq += d.adjustmentsEq;
      if (d.closing!.reason) {
        const r = reasons.get(d.closing!.reason) ?? { count: 0, eq: 0n };
        r.count += 1;
        r.eq += v;
        reasons.set(d.closing!.reason, r);
      }
    }
    const netVarianceEq = shortEq + overEq;

    // ---- by location
    const byLocation = (f.locationId ? locs.filter((l) => l.id === f.locationId) : locs).map((l) => {
      const ds = daily.filter((d) => d.locationId === l.id);
      const expEq = activeExpenses.filter((e) => e.locationId === l.id).reduce((s, e) => s + e.eq, 0n);
      const collectedEq = ds.reduce((s, d) => s + d.salesEq.collected, 0n);
      return {
        locationId: l.id,
        name: l.name,
        days: ds.length,
        closedDays: ds.filter((d) => d.closing).length,
        flaggedDays: ds.filter((d) => d.closing && !d.closing.withinTolerance).length,
        collectedEq,
        expensesEq: expEq,
        cashResultEq: collectedEq - expEq,
        varianceAfterEq: ds.reduce((s, d) => s + (d.varianceAfterEq ?? 0n), 0n),
      };
    });

    const rates = [...new Set(daily.map((d) => d.rate))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return {
      filter: f,
      org: { id: org.id, name: org.name, toleranceCents: org.varianceToleranceCents, costDataVerified: org.costDataVerified },
      location: location ? { id: location.id, name: location.name } : null,
      locations: locs.map((l) => ({ id: l.id, name: l.name })),
      daily,
      expenses: expenseList,
      totals: {
        sales,
        salesEq: salesTotalEq,
        expenses: expenseTotal,
        expensesEq: expenseTotalEq,
        /** Money collected minus expenses recorded. A cash view, not profit. */
        cashResultEq: salesTotalEq.collected - expenseTotalEq,
        voidedExpenses: expenseList.length - activeExpenses.length,
      },
      categories: [...byCategory.values()].sort((a, b) => (a.eq > b.eq ? -1 : a.eq < b.eq ? 1 : a.name.localeCompare(b.name))),
      paidFrom: [...byPaidFrom.entries()].map(([k, v]) => ({ paidFrom: k, ...v })),
      cash: {
        days: daily.length,
        closedDays: closed.length,
        openDays: daily.filter((d) => !d.closing).map((d) => ({ dayId: d.dayId, date: d.date, locationName: d.locationName })),
        balancedDays: closed.filter((d) => d.closing!.withinTolerance).length,
        flaggedDays: closed.filter((d) => !d.closing!.withinTolerance).length,
        shortEq,
        overEq,
        netVarianceEq,
        adjustmentsEq,
        netAfterAdjustmentsEq: netVarianceEq + adjustmentsEq,
        reasons: [...reasons.entries()].map(([reason, v]) => ({ reason, ...v })),
        daysWithoutSales: daily.filter((d) => !d.hasSales).length,
      },
      byLocation,
      rates: { min: rates[0] ?? null, max: rates.at(-1) ?? null, count: rates.length },
      /** Net profit needs verified unit costs (recipe costing), which Phase 1 doesn't collect. */
      netProfit: { available: false as const, reason: "Withheld until unit costs are verified. Recipe costing is not part of this phase." },
    };
  });
}

/** Per-date totals across locations: what the trend chart and calendar plot. */
export function dailyTotals(r: PeriodReport) {
  const byDate = new Map<
    string,
    { date: string; collectedEq: bigint; expensesEq: bigint; varianceAfterEq: bigint; closed: number; open: number; flagged: number }
  >();
  for (let d = r.filter.from; d <= r.filter.to; d = shiftDate(d, 1)) {
    byDate.set(d, { date: d, collectedEq: 0n, expensesEq: 0n, varianceAfterEq: 0n, closed: 0, open: 0, flagged: 0 });
  }
  for (const d of r.daily) {
    const t = byDate.get(d.date)!;
    t.collectedEq += d.salesEq.collected;
    if (d.closing) {
      t.closed++;
      t.varianceAfterEq += d.varianceAfterEq ?? 0n;
      if (!d.closing.withinTolerance) t.flagged++;
    } else t.open++;
  }
  for (const e of r.expenses) if (e.status === "active") byDate.get(e.date)!.expensesEq += e.eq;
  return [...byDate.values()];
}

/** Headline figures for the previous period, for "vs previous" comparisons. */
export async function getComparison(db: DB, scope: TenantScope, filter: ReportFilter) {
  const prev = await getPeriodReport(db, scope, previousPeriod(validateFilter(filter)));
  return {
    filter: prev.filter,
    collectedEq: prev.totals.salesEq.collected,
    expensesEq: prev.totals.expensesEq,
    cashResultEq: prev.totals.cashResultEq,
    netAfterAdjustmentsEq: prev.cash.netAfterAdjustmentsEq,
    days: prev.daily.length,
    daily: dailyTotals(prev).map((d) => ({ date: d.date, collectedEq: d.collectedEq })),
  };
}
