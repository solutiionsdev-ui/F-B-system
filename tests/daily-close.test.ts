// FINCTRL v2.1: the three tabs and the Daily Close workflow, read back
// through the same server functions the pages use. The financial engine is
// unchanged; these check that the new screens read it and nothing else.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadScope, migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { expenses, locations, memberships, organizations, salesLines, users } from "@/db/schema";
import { changedFields } from "@/lib/audit";
import { homePath, visibleTabs } from "@/lib/navigation";
import { omegaSampleCsv } from "@/lib/omega-sample";
import { findCloseDay, isIsoDate, pickCloseDate, recentExpenseTemplates } from "@/server/daily-close";
import { addExpense, getAuditTrail, getDay, openDay, setRate, UserError, voidExpense } from "@/server/operations";
import { createImportDraft, getImport, postImport } from "@/server/pos-import";
import { getPeriodReport } from "@/server/reports";

const TODAY = "2026-11-26";
let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;
const venue: Record<string, string> = {};

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await ensureCedarDemo(database, TODAY);
  const db = database.db;
  const [org] = await db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
  const scopeOf = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadScope(db, u.id, org.id))!;
  };
  owner = await scopeOf("owner@demo.test");
  manager = await scopeOf("manager@demo.test");
  accountant = await scopeOf("accountant@demo.test");
  for (const l of await db.select().from(locations).where(eq(locations.orgId, org.id))) venue[l.name] = l.id;
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe("three tabs and where each person lands", () => {
  it("shows exactly three tabs at most, and Performance only with the reports permission", () => {
    expect(visibleTabs(owner).map((t) => t.label)).toEqual(["Daily Close", "Performance", "Settings & Log"]);
    expect(visibleTabs(accountant).map((t) => t.label)).toEqual(["Daily Close", "Performance", "Settings & Log"]);
    expect(visibleTabs(manager).map((t) => t.label)).toEqual(["Daily Close", "Settings & Log"]);
  });

  it("sends managers to Daily Close and owners and accountants to Performance", () => {
    expect(homePath(manager)).toBe("/close");
    expect(homePath(owner)).toBe("/performance");
    expect(homePath(accountant)).toBe("/performance");
    // A manager allowed to see Performance still starts the night on Daily Close.
    expect(homePath({ role: "manager", permissions: [...(manager.permissions ?? []), "view_reports"] })).toBe("/close");
  });
});

describe("Daily Close: branch and business date", () => {
  it("opens on the date asked for, else the oldest open day at the branch, else today", () => {
    expect(pickCloseDate("2026-11-20", ["2026-11-24"], TODAY)).toBe("2026-11-20");
    expect(pickCloseDate(undefined, ["2026-11-25", "2026-11-24"], TODAY)).toBe("2026-11-24");
    expect(pickCloseDate(undefined, [], TODAY)).toBe(TODAY);
    // Future or malformed dates are ignored.
    expect(pickCloseDate("2026-12-31", [], TODAY)).toBe(TODAY);
    expect(pickCloseDate("2026-02-30", [], TODAY)).toBe(TODAY);
    expect(isIsoDate("2026-11-26")).toBe(true);
    expect(isIsoDate("26/11/2026")).toBe(false);
  });

  it("finds the branch's day and every day still open there, through row-level security", async () => {
    const found = await findCloseDay(database.db, manager, venue["Hamra Roastery"], TODAY);
    expect(found.day?.status).toBe("open");
    expect(found.openDays.map((d) => d.date)).toEqual([TODAY]);
    const flagged = await findCloseDay(database.db, accountant, venue["Hamra Roastery"], "2026-11-24");
    expect(flagged.day?.status).toBe("closed");
    expect((await findCloseDay(database.db, owner, venue["Hamra Roastery"], "2026-10-01")).day).toBeNull();
  });

  it("shows the same figures on Daily Close as Performance, day by day", async () => {
    const report = await getPeriodReport(database.db, owner, { from: "2026-11-15", to: TODAY });
    for (const row of report.daily) {
      const d = (await getDay(database.db, owner, row.dayId))!;
      expect(d.sales.collected).toEqual(row.sales.collected);
      if (row.closing) {
        expect(d.closing!.varianceUsd).toBe(row.closing.variance.USD);
        expect(d.closing!.varianceLbp).toBe(row.closing.variance.LBP);
      } else {
        expect(d.day.status).toBe("open");
      }
    }
  });
});

describe("Daily Close step 1: Omega import", () => {
  it("previews the source total against the FINCTRL total and posts only on confirmation, once", async () => {
    const db = database.db;
    const date = "2026-11-13";
    const day = await openDay(db, manager, { locationId: venue["Gemmayzeh Bistro"], businessDate: date, openingFloat: { USD: 10000n, LBP: 0n } });
    const id = await createImportDraft(db, manager, { locationId: venue["Gemmayzeh Bistro"], fileName: "omega.csv", bytes: new TextEncoder().encode(omegaSampleCsv(date)) });
    const p = (await getImport(db, manager, id))!.preview!;
    expect(p.check.file).toEqual(p.check.posting); // nothing already imported, nothing dropped
    expect(p.check.posting).toEqual({ USD: 85650n, LBP: 4_485_000n }); // $218 + $506.50 + $94 + $50 - $12 refund, and the LBP cash
    expect(p.days.map((x) => x.date)).toEqual([date]);
    expect(await db.select().from(salesLines).where(eq(salesLines.businessDayId, day.id))).toHaveLength(0);

    // Daily Close posts onto the open day without opening others.
    await postImport(db, manager, id, { createMissingDays: false });
    const lines = await db.select().from(salesLines).where(eq(salesLines.businessDayId, day.id));
    expect(lines.length).toBe(p.counts.toImport);
    // A retry (double click, reload, same file again) can't post twice.
    await expect(postImport(db, manager, id, { createMissingDays: false })).rejects.toThrow(UserError);
    const again = await createImportDraft(db, manager, { locationId: venue["Gemmayzeh Bistro"], fileName: "omega (1).csv", bytes: new TextEncoder().encode(omegaSampleCsv(date)) });
    const p2 = (await getImport(db, manager, again))!.preview!;
    expect(p2.counts.toImport).toBe(0);
    expect(p2.check.posting).toEqual({ USD: 0n, LBP: 0n });
    expect(p2.check.file).toEqual(p.check.file); // the file still holds the same money; none of it is new
    await expect(postImport(db, manager, again, { createMissingDays: false })).rejects.toThrow(/nothing new/i);
    expect(await db.select().from(salesLines).where(eq(salesLines.businessDayId, day.id))).toHaveLength(lines.length);
  });
});

describe("Daily Close step 2: expense templates", () => {
  it("offers recent expenses at the branch, one per kind, newest first, and never saves anything", async () => {
    const db = database.db;
    const hamra = venue["Hamra Roastery"];
    const before = await db.select().from(expenses).where(eq(expenses.locationId, hamra));
    const templates = await recentExpenseTemplates(db, manager, hamra);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.length).toBeLessThanOrEqual(6);
    expect(new Set(templates.map((t) => t.key)).size).toBe(templates.length);
    for (let i = 1; i < templates.length; i++) expect(templates[i - 1].lastDate >= templates[i].lastDate).toBe(true);
    expect(templates.every((t) => t.description.trim() !== "")).toBe(true);
    // Reading templates writes nothing.
    expect(await db.select().from(expenses).where(eq(expenses.locationId, hamra))).toHaveLength(before.length);
  });

  it("leaves voided entries out, and keeps each branch's templates to that branch", async () => {
    const db = database.db;
    const hamra = venue["Hamra Roastery"];
    const day = (await findCloseDay(db, manager, hamra, TODAY)).day!;
    const d = (await getDay(db, manager, day.id))!;
    const cat = d.categories.find((c) => c.name === "Generator & Electricity")!;
    const e = await addExpense(db, manager, { dayId: day.id, categoryId: cat.id, currency: "USD", amountMinor: 1234n, paidFrom: "drawer", description: "Typo entry zz" });
    expect((await recentExpenseTemplates(db, manager, hamra)).some((t) => t.description === "Typo entry zz")).toBe(true);
    await voidExpense(db, manager, e.id, "Entered twice");
    expect((await recentExpenseTemplates(db, manager, hamra)).some((t) => t.description === "Typo entry zz")).toBe(false);
    expect((await recentExpenseTemplates(db, manager, venue["Mar Mikhael Taproom"])).some((t) => t.description === "Typo entry zz")).toBe(false);
  });
});

describe("rate badge rules", () => {
  it("needs a source, and keeps the rate with owners by default", async () => {
    const db = database.db;
    await expect(setRate(db, owner, { lbpPerUsd: "89,800", source: "" as "market" })).rejects.toThrow(/where the rate comes from/i);
    await expect(setRate(db, manager, { lbpPerUsd: "89,800", source: "market" })).rejects.toThrow(UserError);
  });
});

describe("Performance branch comparison", () => {
  it("keeps each branch's USD and LBP variances apart and shows the physical cash at its last close", async () => {
    const report = await getPeriodReport(database.db, owner, { from: "2026-11-15", to: TODAY });
    const hamra = report.byLocation.find((l) => l.name === "Hamra Roastery")!;
    expect(hamra.varianceAfter).toEqual({ USD: -2000n, LBP: -45_000n });
    expect(hamra.lastCount?.date).toBe("2026-11-25");
    const others = report.byLocation.filter((l) => l.name !== "Hamra Roastery");
    for (const l of others) expect(l.varianceAfter).toEqual({ USD: 0n, LBP: 0n });
    // The per-currency totals add up to the report's own.
    const sum = report.byLocation.reduce((s, l) => ({ USD: s.USD + l.varianceAfter.USD, LBP: s.LBP + l.varianceAfter.LBP }), { USD: 0n, LBP: 0n });
    expect(sum).toEqual(report.cash.varianceAfter);
  });
});

describe("Settings & Log: audit trail", () => {
  it("filters by person, record and date, and stays limited to the person's venues", async () => {
    const db = database.db;
    const all = await getAuditTrail(db, owner, { limit: 500 });
    expect(all.rows.length).toBeGreaterThan(0);
    expect(all.people.map((p) => p.name).some((n) => /Karim/.test(n))).toBe(true);
    const karimOnly = await getAuditTrail(db, owner, { userId: manager.userId, limit: 500 });
    expect(karimOnly.rows.length).toBeGreaterThan(0);
    expect(karimOnly.rows.every((r) => r.userId === manager.userId)).toBe(true);
    const expensesOnly = await getAuditTrail(db, owner, { table: "expenses", limit: 500 });
    expect(expensesOnly.rows.every((r) => r.tableName === "expenses")).toBe(true);
    const future = await getAuditTrail(db, owner, { from: "2099-01-01" });
    expect(future.rows).toHaveLength(0);
    await expect(getAuditTrail(db, { ...manager, permissions: [] })).rejects.toThrow(UserError);
  });

  it("shows before and after values for a change", () => {
    const changes = changedFields(
      { id: "x", status: "active", amount_minor: "1234", currency: "USD", void_reason: null },
      { id: "x", status: "voided", amount_minor: "1234", currency: "USD", void_reason: "Entered twice" },
    );
    expect(changes).toEqual([
      { field: "status", before: "active", after: "voided" },
      { field: "void reason", before: "—", after: "Entered twice" },
    ]);
    expect(changedFields({ amount_minor: "100", currency: "LBP" }, { amount_minor: "45000", currency: "LBP" })).toEqual([
      { field: "amount minor", before: "LBP 100", after: "LBP 45,000" },
    ]);
  });
});

describe("manager access to Performance", () => {
  it("is off for the demo manager and can be switched on read-only by an owner", async () => {
    const db = database.db;
    await expect(getPeriodReport(db, manager, { from: "2026-11-15", to: TODAY })).rejects.toThrow(UserError);
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, manager.userId), eq(memberships.orgId, manager.orgId)));
    await db.update(memberships).set({ permissions: { ...(m.permissions as object), view_reports: true } }).where(eq(memberships.id, m.id));
    const granted = (await loadScope(db, manager.userId, manager.orgId))!;
    expect(visibleTabs(granted).map((t) => t.key)).toContain("performance");
    expect((await getPeriodReport(db, granted, { from: "2026-11-15", to: TODAY })).byLocation).toHaveLength(3);
    await db.update(memberships).set({ permissions: m.permissions }).where(eq(memberships.id, m.id));
  });
});
