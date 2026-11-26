// Acceptance tests from the FINCTRL v2.0 specification (sections 20 and 21).
//
// Each block is one of the spec's release gates. Requirements that a later
// phase builds are listed as todos, so this file doubles as the remaining
// checklist: a todo becomes a real test when its phase lands.
//
// The fixture is its own business with the spec's three venues, built through
// the same operations the app uses, on fixed November 2026 dates.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { loadScope, migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import {
  auditLog,
  cashCounts,
  exchangeRates,
  expenseCategories,
  expenses,
  locations,
  membershipLocations,
  memberships,
  organizations,
  salesLines,
  users,
} from "@/db/schema";
import { toNotes } from "@/db/seed";
import { reconcile } from "@/lib/closing";
import { DEFAULT_CATEGORIES } from "@/lib/expense-buckets";
import { CURRENCIES, parseRate, zeroPair, type Pair } from "@/lib/money";
import { getStatusSummary } from "@/server/day-status";
import {
  addAdjustment,
  addExpense,
  addMovement,
  closeDay,
  getDashboard,
  getDay,
  openDay,
  saveCount,
  saveManualSales,
  setRate,
  type SalesTotalsInput,
} from "@/server/operations";
import { computePeriodReport, getPeriodReport } from "@/server/reports";
import { updateSettings } from "@/server/team";
import { getToday } from "@/server/today";

let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;
const venue: Record<"gemmayzeh" | "hamra" | "marMikhael", string> = { gemmayzeh: "", hamra: "", marMikhael: "" };
let salariesId = "";

const R89500 = parseRate("89500");
const R89700 = parseRate("89700");

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  const db = database.db;
  const [org] = await db.insert(organizations).values({ name: "Spec Test Hospitality", plan: "multi" }).returning();
  const [rana, karim, nadine] = await db
    .insert(users)
    .values([
      { email: "rana@spec.test", name: "Rana", passwordHash: "x" },
      { email: "karim@spec.test", name: "Karim", passwordHash: "x" },
      { email: "nadine@spec.test", name: "Nadine", passwordHash: "x" },
    ])
    .returning();
  const ms = await db.insert(memberships).values([
    { userId: rana.id, orgId: org.id, role: "owner" },
    { userId: karim.id, orgId: org.id, role: "manager" },
    { userId: nadine.id, orgId: org.id, role: "accountant" },
  ]).returning();
  owner = (await loadScope(db, rana.id, org.id))!;
  manager = (await loadScope(db, karim.id, org.id))!;
  const locs = await db
    .insert(locations)
    .values([
      { orgId: org.id, name: "Gemmayzeh Bistro" },
      { orgId: org.id, name: "Hamra Roastery" },
      { orgId: org.id, name: "Mar Mikhael Taproom" },
    ])
    .returning();
  [venue.gemmayzeh, venue.hamra, venue.marMikhael] = locs.map((l) => l.id);
  // Karim and Nadine work across all three venues here; tests/access.test.ts covers narrower access.
  await db.insert(membershipLocations).values(
    [ms[1], ms[2]].flatMap((m) => locs.map((l) => ({ membershipId: m.id, locationId: l.id, orgId: org.id }))),
  );
  // Nadine may post corrections (an owner granted it); by default an accountant can't.
  await db.update(memberships).set({ permissions: { post_corrections: true } }).where(eq(memberships.id, ms[2].id));
  accountant = (await loadScope(db, nadine.id, org.id))!;
  const cats = await db
    .insert(expenseCategories)
    .values(DEFAULT_CATEGORIES.map((name, i) => ({ orgId: org.id, name, position: i + 1 })))
    .returning();
  salariesId = cats.find((c) => c.name === "Salaries & Wages")!.id;
  // Spec 7.2: 89,500 from 1 Nov; 89,700 from 22 Nov (midnight in Beirut, UTC+2 in November).
  await db.insert(exchangeRates).values([
    { orgId: org.id, lbpPerUsd: "89500.0000", source: "market", createdBy: rana.id, effectiveAt: new Date("2026-10-31T22:00:00Z") },
    { orgId: org.id, lbpPerUsd: "89700.0000", source: "market", createdBy: rana.id, effectiveAt: new Date("2026-11-21T22:00:00Z") },
  ]);
});

afterAll(async () => {
  await database?.close();
});

const zero = zeroPair;
function sales(p: Partial<SalesTotalsInput>): SalesTotalsInput {
  return {
    cash: zero(),
    card: zero(),
    toters: zero(),
    noknok: zero(),
    other: zero(),
    cashRefunds: zero(),
    discounts: zero(),
    voids: zero(),
    tax: zero(),
    serviceCharge: zero(),
    ...p,
  };
}

async function countDrawer(dayId: string, counted: Pair) {
  for (const c of CURRENCIES) {
    const { notes, loose } = toNotes(counted[c], c);
    await saveCount(database.db, manager, { dayId, currency: c, denominations: notes, looseMinor: loose });
  }
}

/** Opens a day with simple cash sales; closes it when asked, short in LBP if asked. */
async function runDay(locationId: string, date: string, opts: { close?: boolean; shortLbp?: bigint } = {}) {
  const db = database.db;
  const day = await openDay(db, manager, { locationId, businessDate: date, openingFloat: { USD: 10000n, LBP: 1_000_000n } });
  await saveManualSales(db, manager, day.id, sales({ cash: { USD: 50000n, LBP: 3_000_000n }, card: { USD: 30000n, LBP: 0n } }));
  if (!opts.close) return day;
  const d = (await getDay(db, manager, day.id))!;
  await countDrawer(day.id, { USD: d.breakdown.expected.USD, LBP: d.breakdown.expected.LBP - (opts.shortLbp ?? 0n) });
  await closeDay(
    db,
    manager,
    day.id,
    opts.shortLbp ? { reason: "counting_error", note: "Recounted twice and still short." } : {},
  );
  return day;
}

// ---------------------------------------------------------------- section 21

describe("Golden financial test case (spec section 21)", () => {
  let dayId = "";

  it("calculates the expected USD and LBP drawers independently", async () => {
    const db = database.db;
    const day = await openDay(db, manager, { locationId: venue.hamra, businessDate: "2026-11-15", openingFloat: zero() });
    dayId = day.id;
    await saveManualSales(
      db,
      manager,
      day.id,
      // Delivery apps $380: Toters $230 and NokNok $150.
      sales({ cash: { USD: 123000n, LBP: 895_000n }, card: { USD: 122000n, LBP: 0n }, toters: { USD: 23000n, LBP: 0n }, noknok: { USD: 15000n, LBP: 0n } }),
    );
    await addExpense(db, manager, { dayId, categoryId: salariesId, currency: "USD", amountMinor: 15000n, paidFrom: "drawer", description: "Shift wages" });
    await addMovement(db, manager, { dayId, kind: "safe_drop", currency: "USD", amountMinor: 20000n });
    await addMovement(db, manager, { dayId, kind: "partner_withdrawal", currency: "USD", amountMinor: 10000n, partnerName: "Sami" });

    const d = (await getDay(db, manager, dayId))!;
    expect(d.rateScaled).toBe(R89500);
    // $0 + $1,230 - $150 - $200 - $100 = $780; 0 + 895,000 = 895,000 LBP
    expect(d.breakdown.expected).toEqual({ USD: 78000n, LBP: 895_000n });
    // Card and delivery-app collections never enter the drawer.
    expect(d.breakdown.cashPayments).toEqual({ USD: 123000n, LBP: 895_000n });
    // Collected = $1,230 + $10 + $1,220 + $380 = $2,840
    const report = await getPeriodReport(db, owner, { from: "2026-11-15", to: "2026-11-15", locationId: venue.hamra });
    expect(report.totals.salesEq.collected).toBe(284000n);
  });

  it("shows the USD and LBP shortages separately and requires a written explanation", async () => {
    const db = database.db;
    await countDrawer(dayId, { USD: 76000n, LBP: 850_000n });
    const d = (await getDay(db, manager, dayId))!;
    expect(d.recon.variance).toEqual({ USD: -2000n, LBP: -45_000n });
    expect(d.recon.varianceEquivCents).toBe(-2050n); // about -$20.50, not -$20.00

    await expect(closeDay(db, manager, dayId, {})).rejects.toThrow(/reason/i);
    await expect(closeDay(db, manager, dayId, { reason: "suspected_loss" })).rejects.toThrow(/explain/i);
    await expect(closeDay(db, manager, dayId, { reason: "suspected_loss", note: "   " })).rejects.toThrow(/explain/i);

    const recon = await closeDay(db, manager, dayId, { reason: "suspected_loss", note: "Short after the evening shift; owner to review." });
    expect(recon.variance).toEqual({ USD: -2000n, LBP: -45_000n });
    expect(recon.withinTolerance).toBe(false);
  });

  it("keeps the safe drop and partner withdrawal out of expenses", async () => {
    const report = await getPeriodReport(database.db, owner, { from: "2026-11-15", to: "2026-11-15", locationId: venue.hamra });
    expect(report.totals.expenses).toEqual({ USD: 15000n, LBP: 0n });
    expect(report.totals.expensesEq).toBe(15000n);
    expect(report.movements.map((m) => [m.kind, m.pair.USD])).toEqual([
      ["safe_drop", 20000n],
      ["partner_withdrawal", 10000n],
    ]);
    expect(report.cash.status).toEqual({ records: 1, closed: 1, balanced: 0, flagged: 1, open: 0 });
  });

  it("leaves the original records unchanged and audits every step with its user", async () => {
    const db = database.db;
    expect(await db.select().from(salesLines).where(eq(salesLines.businessDayId, dayId))).toHaveLength(5);
    const [exp] = await db.select().from(expenses).where(eq(expenses.businessDayId, dayId));
    expect(exp.amountMinor).toBe(15000n);
    expect(exp.status).toBe("active");

    const counts = await db.select({ id: cashCounts.id }).from(cashCounts).where(eq(cashCounts.businessDayId, dayId));
    const ids = [dayId, exp.id, ...counts.map((c) => c.id)];
    const audited = await db.select().from(auditLog).where(inArray(auditLog.rowId, ids));
    const tables = new Set(audited.map((a) => a.tableName));
    for (const t of ["business_days", "expenses", "cash_counts"]) expect(tables.has(t)).toBe(true);
    expect(audited.every((a) => a.userId === manager.userId)).toBe(true);
    const closing = await db.select().from(auditLog).where(and(eq(auditLog.tableName, "day_closings"), eq(auditLog.userId, manager.userId)));
    expect(closing.some((a) => (a.newData as { business_day_id: string }).business_day_id === dayId)).toBe(true);
  });
});

// ---------------------------------------------------------------- section 20

// Test A (tenant and branch isolation) lives in tests/access.test.ts, with
// business-level isolation in tests/db.test.ts and tests/hosted-postgres.test.ts.

describe("Test B: currency and historical rate", () => {
  it("gives each business day the rate in force on its own date", async () => {
    const db = database.db;
    const before = await openDay(db, manager, { locationId: venue.gemmayzeh, businessDate: "2026-11-21", openingFloat: zero() });
    const after = await openDay(db, manager, { locationId: venue.gemmayzeh, businessDate: "2026-11-22", openingFloat: zero() });
    expect((await getDay(db, manager, before.id))!.rateScaled).toBe(R89500);
    expect((await getDay(db, manager, after.id))!.rateScaled).toBe(R89700);
  });

  it("gives a back-dated day its own date's rate, not today's", async () => {
    const day = await openDay(database.db, manager, { locationId: venue.marMikhael, businessDate: "2026-11-18", openingFloat: zero() });
    expect((await getDay(database.db, manager, day.id))!.rateScaled).toBe(R89500);
  });

  it("never changes an open day, a closed day or a report when a new rate is set", async () => {
    const db = database.db;
    const reportBefore = await getPeriodReport(db, owner, { from: "2026-11-15", to: "2026-11-22" });
    const open = await openDay(db, manager, { locationId: venue.hamra, businessDate: "2026-11-23", openingFloat: zero() });
    await setRate(db, owner, { lbpPerUsd: "90,000", source: "market" });
    expect((await getDay(db, manager, open.id))!.rateScaled).toBe(R89700);
    const reportAfter = await getPeriodReport(db, owner, { from: "2026-11-15", to: "2026-11-22" });
    expect(reportAfter.daily.map((d) => d.rate)).toEqual(reportBefore.daily.map((d) => d.rate));
    expect(reportAfter.totals.salesEq.collected).toBe(reportBefore.totals.salesEq.collected);
  });

  it("stores USD and LBP amounts separately, never combined", async () => {
    const lines = await database.db.select().from(salesLines).where(eq(salesLines.orgId, owner.orgId));
    expect(new Set(lines.map((l) => l.currency))).toEqual(new Set(["USD", "LBP"]));
  });

  it.todo("the rate form opens only after Edit Rate and is prefilled with the current rate (Phase 6)");
  it.todo("cancelling the rate form saves nothing; saving asks for confirmation (Phase 6)");
  it.todo("a rate can be set for one venue only (Phase 6)");
});

describe("Test C: POS import", () => {
  // CSV/XLSX upload, preview before posting, mapping and duplicate refusal are in tests/pos-import.test.ts.
  it("counts Toters and NokNok as collected sales, shown apart, never as drawer cash", async () => {
    const db = database.db;
    const day = await openDay(db, manager, { locationId: venue.marMikhael, businessDate: "2026-11-25", openingFloat: zero() });
    await saveManualSales(db, manager, day.id, sales({ cash: { USD: 10000n, LBP: 0n }, toters: { USD: 22000n, LBP: 0n }, noknok: { USD: 15000n, LBP: 0n } }));
    const d = (await getDay(db, manager, day.id))!;
    expect(d.sales.byTender.toters.USD).toBe(22000n);
    expect(d.sales.byTender.noknok.USD).toBe(15000n);
    expect(d.sales.collected.USD).toBe(47000n);
    expect(d.breakdown.expected.USD).toBe(10000n); // only the cash
  });
  it.todo("Toters and NokNok sales sit in clearing accounts until the app pays out to Bank/Whish (accounts phase)");
  it.todo("a receipt number reused on another business day is not treated as a duplicate (Phase 5)");
  it.todo("two payment lines on one receipt are both kept or flagged for review, never dropped (Phase 5)");
  it.todo("POS-reported totals are compared with calculated totals and mismatches shown (Phase 5)");
  it.todo("each batch records accepted, rejected and duplicate counts and the original file (Phase 5)");
});

describe("Test D: expense classification", () => {
  it("bank-paid expenses count as expenses but don't touch the drawer", async () => {
    const db = database.db;
    const day = await runDay(venue.gemmayzeh, "2026-11-24");
    const before = (await getDay(db, manager, day.id))!.breakdown.expected;
    await addExpense(db, manager, { dayId: day.id, categoryId: salariesId, currency: "USD", amountMinor: 50000n, paidFrom: "bank", description: "Monthly salary" });
    expect((await getDay(db, manager, day.id))!.breakdown.expected).toEqual(before);
    await addExpense(db, manager, { dayId: day.id, categoryId: salariesId, currency: "LBP", amountMinor: 900_000n, paidFrom: "drawer", description: "Daily wages" });
    expect((await getDay(db, manager, day.id))!.breakdown.expected).toEqual({ USD: before.USD, LBP: before.LBP - 900_000n });
    const report = await getPeriodReport(db, owner, { from: "2026-11-24", to: "2026-11-24", locationId: venue.gemmayzeh });
    expect(report.totals.expenses).toEqual({ USD: 50000n, LBP: 900_000n });
  });

  it("offers exactly the eight universal hospitality categories, and requires notes", async () => {
    const db = database.db;
    const day = await runDay(venue.hamra, "2026-11-25");
    const d = (await getDay(db, manager, day.id))!;
    expect(d.categories.map((c) => c.name)).toEqual([
      "Salaries & Wages",
      "Food & Kitchen Suppliers",
      "Beverage, Coffee & Bar Suppliers",
      "Generator & Electricity",
      "Rent & Municipal Fees",
      "Packaging & Delivery Supplies",
      "Cleaning, Maintenance & Repairs",
      "Miscellaneous / Petty Cash",
    ]);
    await expect(
      addExpense(db, manager, { dayId: day.id, categoryId: d.categories[0].id, currency: "USD", amountMinor: 1000n, paidFrom: "drawer" }),
    ).rejects.toThrow(/note/i);
  });
  it.todo("Bank and Whish are separate payment sources with a specific account (accounts phase)");
  it.todo("receipts can be attached as files (accounts phase)");
});

describe("Test E: cash movement classification", () => {
  // Safe drops and partner withdrawals reducing the drawer without becoming expenses: see the golden case.
  it("records the partner's name on a withdrawal and never counts movements as expenses", async () => {
    const db = database.db;
    const day = await runDay(venue.gemmayzeh, "2026-11-25");
    await expect(addMovement(db, manager, { dayId: day.id, kind: "partner_withdrawal", currency: "USD", amountMinor: 5000n })).rejects.toThrow(
      /partner/i,
    );
    await addMovement(db, manager, { dayId: day.id, kind: "partner_withdrawal", currency: "USD", amountMinor: 5000n, partnerName: "Georges" });
    await addMovement(db, manager, { dayId: day.id, kind: "safe_drop", currency: "USD", amountMinor: 10000n });
    const report = await getPeriodReport(db, owner, { from: "2026-11-25", to: "2026-11-25", locationId: venue.gemmayzeh });
    expect(report.totals.expensesEq).toBe(0n);
    expect(report.movements.map((m) => m.kind)).toEqual(["safe_drop", "partner_withdrawal"]);
  });

  it("applies an opening float adjustment to the adjusted float exactly once", async () => {
    const db = database.db;
    const [d0] = (await getPeriodReport(db, owner, { from: "2026-11-25", to: "2026-11-25", locationId: venue.gemmayzeh })).daily;
    const before = (await getDay(db, manager, d0.dayId))!;
    await addMovement(db, manager, { dayId: d0.dayId, kind: "float_adjustment", currency: "USD", amountMinor: 2500n, direction: "in", reason: "Float recounted" });
    const after = (await getDay(db, manager, d0.dayId))!;
    expect(after.breakdown.openingFloat).toEqual(before.breakdown.openingFloat);
    expect(after.breakdown.adjustedFloat.USD).toBe(before.breakdown.openingFloat.USD + 2500n);
    expect(after.breakdown.expected.USD).toBe(before.breakdown.expected.USD + 2500n);
  });
  it.todo("a safe drop moves cash into the safe account; a deposit into the bank account (accounts phase)");
  it.todo("both sides of a transfer post together or not at all (accounts phase)");
});

describe("Test F: cash reconciliation", () => {
  it("never lets a USD overage hide an LBP shortage", () => {
    // +$20 in USD and -1,790,000 LBP (-$20 at 89,500): about $0 combined, but both drawers are wrong.
    const r = reconcile({ USD: 100000n, LBP: 5_000_000n }, { USD: 102000n, LBP: 3_210_000n }, R89500, zero());
    expect(r.varianceEquivCents).toBe(0n);
    expect(r.balanced).toBe(false);
    expect(r.withinTolerance).toBe(false);
  });

  it("asks for an explanation for any difference, however small", async () => {
    const db = database.db;
    const day = await runDay(venue.marMikhael, "2026-11-16");
    const d = (await getDay(db, manager, day.id))!;
    await countDrawer(day.id, { USD: d.breakdown.expected.USD, LBP: d.breakdown.expected.LBP - 1_000n });
    await expect(closeDay(db, manager, day.id, {})).rejects.toThrow(/reason/i);
    await expect(closeDay(db, manager, day.id, { reason: "rate_rounding" })).rejects.toThrow(/explain/i);
    await closeDay(db, manager, day.id, { reason: "rate_rounding", note: "Change given in LBP, rounded down." });
  });

  it("lets a tolerance change Balanced to Flagged, never skip the explanation", async () => {
    const db = database.db;
    await updateSettings(db, owner, { name: "Spec Test Hospitality", toleranceUsd: "0", toleranceLbp: "5,000" });
    const day = await runDay(venue.marMikhael, "2026-11-17");
    const d = (await getDay(db, manager, day.id))!;
    await countDrawer(day.id, { USD: d.breakdown.expected.USD, LBP: d.breakdown.expected.LBP - 1_000n });
    await expect(closeDay(db, manager, day.id, {})).rejects.toThrow(/reason/i);
    const recon = await closeDay(db, manager, day.id, { reason: "rate_rounding", note: "LBP change rounding." });
    expect(recon.withinTolerance).toBe(true);
    const closed = (await getDay(db, manager, day.id))!.closing!;
    expect(closed.toleranceLbp).toBe(5_000n);
    await updateSettings(db, owner, { name: "Spec Test Hospitality", toleranceUsd: "0", toleranceLbp: "0" });
  });

  it("makes closed-day corrections additive and keeps the original locked", async () => {
    const db = database.db;
    const day = await runDay(venue.hamra, "2026-11-16", { close: true, shortLbp: 45_000n });
    await addAdjustment(db, accountant, { dayId: day.id, currency: "LBP", amountMinor: 45_000n, reason: "Receipt found for a drawer payout" });
    const d = (await getDay(db, manager, day.id))!;
    expect(d.closing!.varianceLbp).toBe(-45_000n);
    expect(d.adjustments).toHaveLength(1);
    await expect(
      withTenant(db, manager, (tx) => tx.update(salesLines).set({ amountMinor: 1n }).where(eq(salesLines.businessDayId, day.id))),
    ).rejects.toThrow();
  });
});

describe("Closing requirements (spec 13.2)", () => {
  it("won't close a day with no sales unless someone says why", async () => {
    const db = database.db;
    const day = await openDay(db, manager, { locationId: venue.gemmayzeh, businessDate: "2026-11-19", openingFloat: { USD: 10000n, LBP: 0n } });
    await countDrawer(day.id, { USD: 10000n, LBP: 0n });
    await expect(closeDay(db, manager, day.id, {})).rejects.toThrow(/no sales/i);
    await closeDay(db, manager, day.id, { noSalesReason: "Closed for a public holiday." });
    const d = (await getDay(db, manager, day.id))!;
    expect(d.closing!.noSalesReason).toBe("Closed for a public holiday.");
  });
});

describe("Test G: cross-screen counts", () => {
  // 3 venues x 12 days = 36 records: more than the 30 the Today page used to read.
  // One old day is left open and one day is flagged.
  const from = "2026-11-01";
  const to = "2026-11-12";
  let oldOpenId = "";
  let flaggedId = "";

  beforeAll(async () => {
    for (let n = 1; n <= 12; n++) {
      const date = `2026-11-${String(n).padStart(2, "0")}`;
      for (const [key, id] of Object.entries(venue)) {
        if (key === "gemmayzeh" && n === 2) oldOpenId = (await runDay(id, date)).id;
        else if (key === "hamra" && n === 10) flaggedId = (await runDay(id, date, { close: true, shortLbp: 45_000n })).id;
        else await runDay(id, date, { close: true });
      }
    }
  }, 120_000);

  it("counts 36 records: 35 closed (34 balanced, 1 flagged) and 1 open", async () => {
    const summary = await getStatusSummary(database.db, owner, { from, to });
    expect(summary).toEqual({ records: 36, closed: 35, balanced: 34, flagged: 1, open: 1 });
  });

  it("shows the same counts on Today, Cash Closing and Reports", async () => {
    const db = database.db;
    const summary = await getStatusSummary(db, owner, { from, to });
    const report = await getPeriodReport(db, owner, { from, to }); // Reports and Cash Closing
    const today = await getToday(db, owner, to); // month to date = 1-12 Nov
    expect(report.cash.status).toEqual(summary);
    expect(today.status).toEqual(summary);
  });

  it("never loses an old open day from Today", async () => {
    const db = database.db;
    const dash = await getDashboard(db, owner, to);
    expect(dash.openDays.map((d) => d.id)).toContain(oldOpenId);
    const today = await getToday(db, owner, to);
    expect(today.needs.map((n) => n.key)).toContain(`open-${oldOpenId}`);
  });

  it("keeps Today's flagged count equal to Reports after a correction", async () => {
    const db = database.db;
    await addAdjustment(db, accountant, { dayId: flaggedId, currency: "LBP", amountMinor: 45_000n, reason: "Miscounted bundle found" });
    const today = await getToday(db, owner, to);
    const week = await computePeriodReport(db, owner, { from: "2026-11-06", to });
    expect(week.cash.flaggedDays).toBe(1);
    expect(today.kpis.difference.flagged).toBe(week.cash.flaggedDays);
    // Corrected, so it no longer needs anyone's attention.
    expect(today.needs.map((n) => n.key)).not.toContain(`flag-${flaggedId}`);
  });
});

describe("Test H: demo financial totals", () => {
  it.todo("Cedar Hospitality Group 1-26 Nov: $110,000 collected, $74,800 expenses, $35,200 remainder, 32.0% (Phase 7)");
  it.todo("venue and category totals reconcile exactly and original LBP totals stay available (Phase 7)");
  it.todo("Toters/NokNok payouts never add to collected sales (Phase 5)");
});
