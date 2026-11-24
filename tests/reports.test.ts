import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { seedDemo } from "@/db/seed";
import { memberships, organizations, users } from "@/db/schema";
import { usdEquivalent } from "@/lib/money";
import { csvCell, num, toCsv } from "@/lib/csv";
import { addAdjustment, addExpense, getDay, todayIn, UserError, voidExpense } from "@/server/operations";
import { getComparison, getPeriodReport, previousPeriod, shiftDate, validateFilter } from "@/server/reports";
import { dailyCsv, expensesCsv, reportFileName } from "@/server/report-csv";
import { renderReportPdf } from "@/server/report-pdf";

let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;
let bistroOwner: TenantScope;
const today = todayIn();
const week = { from: shiftDate(today, -7), to: today };

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await seedDemo(database.db);
  const scopeFor = async (email: string, orgName: string): Promise<TenantScope> => {
    const [row] = await database.db
      .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.email, email), eq(organizations.name, orgName)));
    return row;
  };
  owner = await scopeFor("owner@demo.test", "Demo Café Group");
  manager = await scopeFor("manager@demo.test", "Demo Café Group");
  accountant = await scopeFor("accountant@demo.test", "Demo Café Group");
  bistroOwner = await scopeFor("bistro@demo.test", "Demo Bistro");
});

afterAll(async () => {
  await database?.close();
});

describe("access", () => {
  it("is for owners and accountants", async () => {
    await expect(getPeriodReport(database.db, manager, week)).rejects.toThrow(UserError);
    await expect(getPeriodReport(database.db, accountant, week)).resolves.toBeTruthy();
  });

  it("only ever contains the signed-in group's data", async () => {
    const r = await getPeriodReport(database.db, bistroOwner, week);
    expect(r.locations.map((l) => l.name)).toEqual(["Mar Mikhael"]);
    expect(new Set(r.daily.map((d) => d.locationName))).toEqual(new Set(["Mar Mikhael"]));
    expect(r.daily).toHaveLength(3);
  });
});

describe("period report", () => {
  it("covers every day and location in the period", async () => {
    const r = await getPeriodReport(database.db, owner, week);
    expect(r.daily).toHaveLength(12); // Hamra 8 days, Gemmayzeh 4
    expect(r.cash.closedDays).toBe(11);
    expect(r.cash.openDays).toHaveLength(1);
    expect(r.cash.flaggedDays).toBe(1);
    expect(r.cash.netVarianceEq).toBe(-2000n);
    expect(r.rates.count).toBe(2);
    expect(r.netProfit.available).toBe(false);
  });

  it("converts each day at its own rate, then adds up", async () => {
    const r = await getPeriodReport(database.db, owner, week);
    let sum = 0n;
    for (const d of r.daily) {
      expect(d.salesEq.collected).toBe(usdEquivalent(d.sales.collected, d.rate));
      sum += d.salesEq.collected;
    }
    expect(r.totals.salesEq.collected).toBe(sum);
    expect(r.totals.cashResultEq).toBe(r.totals.salesEq.collected - r.totals.expensesEq);
    const catSum = r.categories.reduce((s, c) => s + c.eq, 0n);
    expect(catSum).toBe(r.totals.expensesEq);
    const locSum = r.byLocation.reduce((s, l) => s + l.collectedEq, 0n);
    expect(locSum).toBe(r.totals.salesEq.collected);
  });

  it("filters to one location", async () => {
    const all = await getPeriodReport(database.db, owner, week);
    const gem = all.locations.find((l) => l.name === "Gemmayzeh")!;
    const r = await getPeriodReport(database.db, owner, { ...week, locationId: gem.id });
    expect(r.daily).toHaveLength(4);
    expect(r.byLocation).toHaveLength(1);
    expect(r.expenses.every((e) => e.locationName === "Gemmayzeh")).toBe(true);
  });

  it("leaves voided expenses out of the totals but lists them", async () => {
    const before = await getPeriodReport(database.db, owner, week);
    const open = before.cash.openDays[0];
    const day = (await getDay(database.db, manager, open.dayId))!;
    const exp = await addExpense(database.db, manager, {
      dayId: open.dayId,
      categoryId: day.categories[0].id,
      description: "Mistake",
      currency: "USD",
      amountMinor: 5000n,
      paidFrom: "drawer",
    });
    await voidExpense(database.db, manager, exp.id, "Entered twice");
    const after = await getPeriodReport(database.db, owner, week);
    expect(after.totals.expensesEq).toBe(before.totals.expensesEq);
    expect(after.totals.voidedExpenses).toBe(before.totals.voidedExpenses + 1);
    expect(after.expenses.find((e) => e.id === exp.id)?.status).toBe("voided");
  });

  it("shows corrections separately from the frozen closing difference", async () => {
    const r0 = await getPeriodReport(database.db, owner, week);
    const flagged = r0.daily.find((d) => d.closing && !d.closing.withinTolerance)!;
    await addAdjustment(database.db, accountant, {
      dayId: flagged.dayId,
      currency: "LBP",
      amountMinor: 1_790_000n,
      reason: "Receipt found",
    });
    const r = await getPeriodReport(database.db, owner, week);
    expect(r.cash.netVarianceEq).toBe(-2000n);
    expect(r.cash.adjustmentsEq).toBe(2000n);
    expect(r.cash.netAfterAdjustmentsEq).toBe(0n);
  });

  it("compares with the period before", async () => {
    expect(previousPeriod({ from: "2026-11-01", to: "2026-11-30" })).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
      locationId: undefined,
    });
    const cmp = await getComparison(database.db, owner, { from: shiftDate(today, -2), to: today });
    expect(cmp.days).toBeGreaterThan(0);
  });

  it("rejects bad periods", () => {
    expect(() => validateFilter({ from: "2026-11-30", to: "2026-11-01" })).toThrow(UserError);
    expect(() => validateFilter({ from: "2025-01-01", to: "2026-11-01" })).toThrow(/one year/);
    expect(() => validateFilter({ from: "nope", to: "2026-11-01" })).toThrow(UserError);
    expect(() => validateFilter({ from: "2026-11-01", to: "2026-11-02", locationId: "x" })).toThrow(UserError);
  });

  it("handles a period with no activity", async () => {
    const r = await getPeriodReport(database.db, owner, { from: "2020-01-01", to: "2020-01-31" });
    expect(r.daily).toHaveLength(0);
    expect(r.totals.salesEq.collected).toBe(0n);
    expect(r.rates.min).toBeNull();
    const pdf = await renderReportPdf(r, { generatedBy: "Test" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("CSV", () => {
  it("escapes quotes and commas and defuses formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+961 3 000000")).toBe("'+961 3 000000");
    expect(csvCell(num("-12.50"))).toBe("-12.50");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a"], [["Café"]]).startsWith("﻿a\r\nCafé")).toBe(true);
  });

  it("exports one row per day and every expense", async () => {
    const r = await getPeriodReport(database.db, owner, week);
    const daily = dailyCsv(r).replace(/^﻿/, "").trim().split("\r\n");
    expect(daily).toHaveLength(r.daily.length + 1);
    expect(daily[0].split(",")).toContain("difference_after_adjustments_usd_equiv");
    expect(daily[1]).not.toMatch(/\d,\d{3},\d{3}/); // no thousands separators in numbers
    const exp = expensesCsv(r).replace(/^﻿/, "").trim().split("\r\n");
    expect(exp).toHaveLength(r.expenses.length + 1);
    expect(reportFileName(r, "daily", "csv")).toBe(`demo-cafe-group_daily_${week.from}_${week.to}.csv`);
  });
});

describe("PDF", () => {
  it("renders a multi-page management report", async () => {
    const r = await getPeriodReport(database.db, owner, week);
    const cmp = await getComparison(database.db, owner, week);
    const pdf = await renderReportPdf(r, { comparison: cmp, generatedBy: "Rana (Owner)" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});
