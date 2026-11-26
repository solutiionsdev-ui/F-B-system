// The Cedar Hospitality Group demo business (spec section 16, in its 12-day
// form): three venues, realistic margins, one flagged day, and "today" open
// with the spec's own figures. Everything is read back through the app.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadScope, migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { memberships, organizations, users } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { UNIVERSAL_CATEGORIES } from "@/lib/expense-buckets";
import { can } from "@/lib/permissions";
import { getStatusSummary } from "@/server/day-status";
import { listMovements } from "@/server/ledgers";
import { addAdjustment, getDay, listLocations, setRate, UserError } from "@/server/operations";
import { getPeriodReport } from "@/server/reports";
import { getToday } from "@/server/today";

const TODAY = "2026-11-26";
const FROM = "2026-11-15"; // 11 days back
let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;

const pct = (part: bigint, whole: bigint) => (Number(part) / Number(whole)) * 100;

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  // On top of the older demo groups, as on the live site.
  await seedDemo(database.db);
  expect(await ensureCedarDemo(database, TODAY)).toBe(true);
  const db = database.db;
  const [org] = await db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
  const scopeOf = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadScope(db, u.id, org.id))!;
  };
  owner = await scopeOf("owner@demo.test");
  manager = await scopeOf("manager@demo.test");
  accountant = await scopeOf("accountant@demo.test");
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe("Cedar Hospitality Group demo", () => {
  it("is added once and never duplicated", async () => {
    expect(await ensureCedarDemo(database, TODAY)).toBe(false);
    const orgs = await database.db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
    expect(orgs).toHaveLength(1);
    // The demo people keep their other businesses and gain this one.
    const [rana] = await database.db.select().from(users).where(eq(users.email, "owner@demo.test"));
    expect(await database.db.select().from(memberships).where(eq(memberships.userId, rana.id))).toHaveLength(2);
  });

  it("has the three venues with their types and the spec's eight categories", async () => {
    const locs = await listLocations(database.db, owner);
    expect(locs.map((l) => [l.name, l.venueType])).toEqual([
      ["Gemmayzeh Bistro", "restaurant"],
      ["Hamra Roastery", "cafe"],
      ["Mar Mikhael Taproom", "pub"],
    ]);
    const report = await getPeriodReport(database.db, owner, { from: FROM, to: TODAY });
    for (const c of report.categories) expect(UNIVERSAL_CATEGORIES).toContain(c.name);
    expect(report.categories).toHaveLength(8);
    expect(report.rates).toMatchObject({ count: 1 });
  });

  it("covers 12 days per venue: 33 closed (32 balanced, 1 flagged) and 3 open", async () => {
    const summary = await getStatusSummary(database.db, owner, { from: FROM, to: TODAY });
    expect(summary).toEqual({ records: 36, closed: 33, balanced: 32, flagged: 1, open: 3 });
  });

  it("shows a realistic result: expenses near 68% of collected, salaries near 25%", async () => {
    const report = await getPeriodReport(database.db, owner, { from: FROM, to: TODAY });
    const collected = report.totals.salesEq.collected;
    const margin = pct(report.totals.cashResultEq, collected);
    expect(margin).toBeGreaterThan(30);
    expect(margin).toBeLessThan(35);
    const salaries = report.categories.find((c) => c.name === "Salaries & Wages")!;
    expect(pct(salaries.eq, collected)).toBeGreaterThan(22);
    expect(pct(salaries.eq, collected)).toBeLessThan(27);
    for (const l of report.byLocation) {
      const m = pct(l.cashResultEq, l.collectedEq);
      expect(m).toBeGreaterThan(29);
      expect(m).toBeLessThan(36);
    }
    // Safe drops and partner withdrawals are there, and are not expenses.
    expect(report.movements.map((m) => m.kind).sort()).toEqual(["partner_withdrawal", "safe_drop"]);
    expect(report.movements.find((m) => m.kind === "partner_withdrawal")!.pair.USD).toBe(45000n); // $100 + $150 + $200
    const moves = await listMovements(database.db, owner, { from: FROM, to: TODAY });
    expect(moves.filter((m) => m.kind === "partner_withdrawal").every((m) => Boolean(m.partnerName))).toBe(true);
    expect(report.expenses.every((e) => e.description.trim() !== "")).toBe(true); // every expense has its note
  });

  it("has exactly one flagged day: Hamra Roastery, short $20 and 45,000 LBP, with the spec's drawer figures", async () => {
    const report = await getPeriodReport(database.db, owner, { from: FROM, to: TODAY });
    const flagged = report.daily.filter((d) => d.dayStatus === "closed_flagged");
    expect(flagged).toHaveLength(1);
    const f = flagged[0];
    expect(f.locationName).toBe("Hamra Roastery");
    expect(f.date).toBe("2026-11-24");
    expect(f.closing!.expected).toEqual({ USD: 120000n, LBP: 3_500_000n });
    expect(f.closing!.counted).toEqual({ USD: 118000n, LBP: 3_455_000n });
    expect(f.closing!.variance).toEqual({ USD: -2000n, LBP: -45_000n });
    expect(f.closing!.note).toMatch(/flagged for owner review/);
    expect(f.closing!.closedByName).toMatch(/Karim/);
  });

  it("balances every closed day exactly the way the app would work it out", async () => {
    const report = await getPeriodReport(database.db, owner, { from: FROM, to: TODAY });
    for (const d of report.daily.filter((x) => x.closing)) {
      const day = (await getDay(database.db, owner, d.dayId))!;
      expect(day.breakdown.expected).toEqual(d.closing!.expected);
      expect(d.closing!.expected.USD).toBeGreaterThanOrEqual(0n);
      expect(d.closing!.expected.LBP).toBeGreaterThanOrEqual(0n);
    }
  });

  it("opens today at all three venues with the spec's figures", async () => {
    const report = await getPeriodReport(database.db, owner, { from: TODAY, to: TODAY });
    expect(report.totals.salesEq.collected).toBe(320000n); // $3,200
    expect(report.totals.sales.byTender.cash).toEqual({ USD: 85000n, LBP: 6_279_000n });
    expect(report.totals.sales.byTender.card.USD).toBe(145000n); // $1,450
    expect(report.totals.sales.byTender.toters.USD).toBe(51000n); // $510
    expect(report.totals.sales.byTender.noknok.USD).toBe(32000n); // $320
    expect(report.totals.expensesEq).toBe(25000n); // $250
    const expected: Record<string, { USD: bigint; LBP: bigint }> = {
      "Gemmayzeh Bistro": { USD: 45000n, LBP: 5_691_000n },
      "Hamra Roastery": { USD: 37000n, LBP: 3_794_000n },
      "Mar Mikhael Taproom": { USD: 45000n, LBP: 2_794_000n },
    };
    for (const d of report.daily) {
      const day = (await getDay(database.db, manager, d.dayId))!;
      expect(day.day.status).toBe("open");
      expect(day.breakdown.expected).toEqual(expected[d.locationName]);
      expect(day.countsComplete).toBe(false); // counts stay blank until a manager enters them
    }
  });

  it("puts the flagged day and today's open days in the owner's Needs you list", async () => {
    const today = await getToday(database.db, owner, TODAY);
    const keys = today.needs.map((n) => n.key);
    expect(keys.filter((k) => k.startsWith("open-"))).toHaveLength(3);
    const flag = today.needs.find((n) => n.key.startsWith("flag-"))!;
    expect(flag.title).toMatch(/Hamra Roastery/);
    expect(flag.pill).toBe("Short $20.00 · LBP 45,000");
    expect(today.kpis.difference).toMatchObject({ flagged: 1, value: { USD: -2000n, LBP: -45_000n } });
  });

  it("gives each demo person the access the brief describes", async () => {
    // Manager: runs the day, can't change the rate.
    expect(can(manager, "close_days")).toBe(true);
    await expect(setRate(database.db, manager, { lbpPerUsd: "90,000", source: "market" })).rejects.toThrow(UserError);
    // Accountant: read-only, exports, and additive corrections.
    expect(can(accountant, "record_transactions")).toBe(false);
    expect(can(accountant, "export_reports")).toBe(true);
    const report = await getPeriodReport(database.db, accountant, { from: FROM, to: TODAY });
    const flagged = report.daily.find((d) => d.dayStatus === "closed_flagged")!;
    await addAdjustment(database.db, accountant, { dayId: flagged.dayId, currency: "LBP", amountMinor: 45_000n, reason: "Receipt found for a small payout" });
    const after = (await getDay(database.db, owner, flagged.dayId))!;
    expect(after.closing!.varianceLbp).toBe(-45_000n); // the closed figure never changes
    expect(after.adjustments).toHaveLength(1);
    // Everyone sees all three venues in this demo.
    const [m] = await database.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, manager.userId), eq(memberships.orgId, manager.orgId)));
    expect(m.role).toBe("manager");
    expect(await listLocations(database.db, manager)).toHaveLength(3);
  });
});
