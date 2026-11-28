// The cost alert on Performance: running costs (every expense) as a share of
// sales, the last 30 days against the 30 before. Made-up figures only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadScope, migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { organizations, users } from "@/db/schema";
import { costAlert, type PeriodTotals } from "@/lib/cost-alert";
import { HISTORY_HEADERS } from "@/lib/history-template";
import { writeXlsx } from "@/lib/xlsx-writer";
import { branchTotals, getCostAlert } from "@/server/cost-alert";
import { createDayImport, postDayImport } from "@/server/history";
import { getPeriodReport } from "@/server/reports";
import { updateSettings } from "@/server/team";

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));
const branch = (id: string, sales: number, costs: number, categories: Record<string, number> = {}, salesDays = 30): PeriodTotals => ({
  locationId: id,
  name: id,
  salesEq: usd(sales),
  costsEq: usd(costs),
  salesDays,
  categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, usd(v)])),
});

describe("when costs take a bigger share of sales", () => {
  it("stays quiet when a busier month simply costs more", () => {
    const a = costAlert([branch("A", 20_000, 12_000)], [branch("A", 10_000, 6_000)]);
    expect(a.overall).toMatchObject({ shareNowBp: 6000, shareBeforeBp: 6000, riseBp: 0, costsChangeBp: 10_000, salesChangeBp: 10_000 });
    expect(a.show).toBe(false);
  });

  it("alerts when the share grows by the threshold, and the rise is the price change that brings it back", () => {
    // 60% → 66% of sales: 10% bigger. Prices 10% higher on the same sales: 6,600 / 11,000 = 60% again.
    const a = costAlert([branch("A", 10_000, 6_600)], [branch("A", 10_000, 6_000)]);
    expect(a.overall).toMatchObject({ shareNowBp: 6600, shareBeforeBp: 6000, riseBp: 1000 });
    expect(a.show).toBe(true);
    // Exactly at the line counts; just under doesn't.
    expect(costAlert([branch("A", 10_000, 6_300)], [branch("A", 10_000, 6_000)]).show).toBe(true);
    expect(costAlert([branch("A", 10_000, 6_290)], [branch("A", 10_000, 6_000)]).show).toBe(false);
    expect(costAlert([branch("A", 10_000, 6_290)], [branch("A", 10_000, 6_000)], 400).show).toBe(true);
  });

  it("counts every cost, not only food, and shows which went up most against sales", () => {
    const a = costAlert(
      [branch("A", 10_000, 6_900, { "Generator & Electricity": 1_200, "Food & Kitchen Suppliers": 3_000, "Rent & Municipal Fees": 1_500, "Salaries & Wages": 1_200 })],
      [branch("A", 10_000, 6_000, { "Generator & Electricity": 600, "Food & Kitchen Suppliers": 2_700, "Rent & Municipal Fees": 1_500, "Salaries & Wages": 1_200 })],
    );
    expect(a.overall!.riseBp).toBe(1500);
    expect(a.categories.map((c) => [c.name, c.pointsBp])).toEqual([
      ["Generator & Electricity", 600],
      ["Food & Kitchen Suppliers", 300],
      ["Rent & Municipal Fees", 0],
      ["Salaries & Wages", 0],
    ]);
  });

  it("compares only branches with enough history in both periods, and names the others", () => {
    const a = costAlert(
      [branch("A", 10_000, 6_000), branch("B", 5_000, 4_000), branch("C", 4_000, 2_000)],
      [branch("A", 10_000, 6_000), branch("B", 5_000, 3_000, {}, 6)],
    );
    expect(a.branches.map((b) => b.name)).toEqual(["A"]);
    expect(a.notCompared).toEqual(["B", "C"]);
    expect(a.overall).toMatchObject({ salesNow: usd(10_000), riseBp: 0 });
    expect(a.show).toBe(false);
  });

  it("alerts for one branch whose share grew even when the total didn't", () => {
    const a = costAlert([branch("A", 10_000, 5_400), branch("B", 5_000, 3_300)], [branch("A", 10_000, 6_000), branch("B", 5_000, 3_000)]);
    expect(a.overall!.riseBp).toBeLessThan(500);
    expect(a.branches[0]).toMatchObject({ name: "B", riseBp: 1000, over: true });
    expect(a.show).toBe(true);
  });

  it("says nothing without history to compare", () => {
    expect(costAlert([branch("A", 10_000, 6_000)], [])).toMatchObject({ overall: null, show: false, notCompared: ["A"] });
    expect(costAlert([branch("A", 10_000, 6_000)], [branch("A", 10_000, 0)]).show).toBe(false);
  });
});

describe("the alert on real records", () => {
  let database: Database;
  let owner: TenantScope;
  let manager: TenantScope;

  beforeAll(async () => {
    database = await openPglite();
    await migrate(database);
    await ensureCedarDemo(database, "2026-11-26");
    const db = database.db;
    const [org] = await db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
    const scopeOf = async (email: string) => {
      const [u] = await db.select().from(users).where(eq(users.email, email));
      return (await loadScope(db, u.id, org.id))!;
    };
    owner = await scopeOf("owner@demo.test");
    manager = await scopeOf("manager@demo.test");
  }, 120_000);

  afterAll(async () => {
    await database?.close();
  });

  it("compares the last 30 full days with the 30 before, from the same figures as the report", async () => {
    // No history before the demo's 12 days: nothing to compare yet.
    const quiet = await getCostAlert(database.db, owner, { today: "2026-11-27", locationId: null });
    expect(quiet.window).toMatchObject({ from: "2026-10-28", to: "2026-11-26" });
    expect(quiet.previous).toMatchObject({ from: "2026-09-28", to: "2026-10-27" });
    expect(quiet).toMatchObject({ show: false, overall: null });

    // Ten October days for one branch, brought in from Excel: $2,000 sold and $100 of supplies a day, paid by bank.
    const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 + i).padStart(2, "0")}`);
    const row = (d: string) => HISTORY_HEADERS.days.map((h) => ({ Date: d, Branch: "Gemmayzeh Bistro", "Cash USD": 2000, "Counted USD": 2000, "Counted LBP": 0 })[h as "Date"] ?? "");
    const bytes = writeXlsx([
      { name: "Days", rows: [HISTORY_HEADERS.days, ...days.map(row)] },
      { name: "Expenses", rows: [HISTORY_HEADERS.expenses, ...days.map((d) => [d, "Gemmayzeh Bistro", "Food & Kitchen Suppliers", 100, "USD", "Bank / Whish", "Market", "Produce"])] },
    ]);
    const id = await createDayImport(database.db, owner, { fileName: "october.xlsx", bytes });
    expect(await postDayImport(database.db, owner, id)).toMatchObject({ closedBalanced: 10 });

    const alert = await getCostAlert(database.db, owner, { today: "2026-11-27", locationId: null });
    expect(alert.branches.map((b) => b.name)).toEqual(["Gemmayzeh Bistro"]);
    expect(alert.notCompared).toEqual(["Hamra Roastery", "Mar Mikhael Taproom"]);
    expect(alert.overall).toMatchObject({ salesBefore: 2_000_000n, costsBefore: 100_000n, shareBeforeBp: 500 });
    // The current figures are the report's own.
    const report = await getPeriodReport(database.db, owner, alert.window);
    const g = branchTotals(report).find((b) => b.name === "Gemmayzeh Bistro")!;
    expect(alert.overall).toMatchObject({ salesNow: g.salesEq, costsNow: g.costsEq });
    expect(alert.show).toBe(alert.overall!.riseBp >= 500);
    expect(alert.show).toBe(true);
    // The categories cover every kind of expense the branch recorded, not only food.
    expect(alert.categories.length).toBeGreaterThan(1);
  });

  it("is part of Performance: managers without report access don't get it", async () => {
    await expect(getCostAlert(database.db, manager, { today: "2026-11-27", locationId: null })).rejects.toThrow(/see reports/);
  });

  it("lets the owner set the threshold between 1% and 50%", async () => {
    const base = { name: CEDAR_NAME, toleranceUsd: "1", toleranceLbp: "100000" };
    await updateSettings(database.db, owner, { ...base, costAlert: "7.5" });
    const [org] = await database.db.select().from(organizations).where(eq(organizations.id, owner.orgId));
    expect(org.costAlertBp).toBe(750);
    expect((await getCostAlert(database.db, owner, { today: "2026-11-27", locationId: null })).thresholdBp).toBe(750);
    await expect(updateSettings(database.db, owner, { ...base, costAlert: "0.5" })).rejects.toThrow(/between 1% and 50%/);
    await expect(updateSettings(database.db, owner, { ...base, costAlert: "lots" })).rejects.toThrow(/percentage/);
    await expect(updateSettings(database.db, manager, { ...base, costAlert: "10" })).rejects.toThrow();
    // Leaving it out keeps it.
    await updateSettings(database.db, owner, base);
    const [after] = await database.db.select().from(organizations).where(eq(organizations.id, owner.orgId));
    expect(after.costAlertBp).toBe(750);
  });
});
