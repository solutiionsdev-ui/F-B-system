// Runs the real migrations on an in-memory Postgres (PGlite), seeds the demo
// data through the same operations the app uses, then attacks the
// guarantees in the business plan: isolation, roles, locked days,
// immutable history and duplicate protection.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { seedDemo } from "@/db/seed";
import {
  auditLog,
  businessDays,
  dayClosings,
  exchangeRates,
  expenses,
  memberships,
  organizations,
  posImports,
  salesLines,
  users,
} from "@/db/schema";
import {
  addAdjustment,
  addExpense,
  closeDay,
  getDashboard,
  getDay,
  saveCount,
  setOpeningFloat,
  setRate,
  todayIn,
  UserError,
} from "@/server/operations";
import { parseRate } from "@/lib/money";

let database: Database;
let cafe: TenantScope; // manager
let cafeOwner: TenantScope;
let cafeAccountant: TenantScope;
let bistro: TenantScope; // owner

/** Finds the Postgres error code inside Drizzle's wrapped error. */
function pgCode(e: unknown): string | undefined {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 5; i++) {
    if (cur.code) return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}
async function expectPgError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(pgCode(e)).toBe(code);
    return;
  }
  throw new Error(`expected Postgres error ${code}`);
}

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await seedDemo(database.db);
  const db = database.db;
  const scopeFor = async (email: string, orgName: string): Promise<TenantScope> => {
    const [row] = await db
      .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.email, email), eq(organizations.name, orgName)));
    return row;
  };
  cafe = await scopeFor("manager@demo.test", "Demo Café Group");
  cafeOwner = await scopeFor("owner@demo.test", "Demo Café Group");
  cafeAccountant = await scopeFor("accountant@demo.test", "Demo Café Group");
  bistro = await scopeFor("bistro@demo.test", "Demo Bistro");
});

afterAll(async () => {
  await database?.close();
});

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(database)).toEqual([]);
  });
});

describe("demo seed", () => {
  it("creates closed history and one open day today", async () => {
    const dash = await getDashboard(database.db, cafe);
    expect(dash.openDays).toHaveLength(1);
    expect(dash.openDays[0].businessDate).toBe(todayIn());
    expect(dash.recent.filter((d) => d.status === "closed").length).toBeGreaterThanOrEqual(10);
    const flagged = dash.recent.filter((d) => d.withinTolerance === false);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].varianceReason).toBe("unrecorded_expense");
    expect(flagged[0].varianceEquivCents).toBe(-2000n);
  });
});

describe("tenant isolation", () => {
  it("hides other groups' data even without a filter", async () => {
    const seen = await withTenant(database.db, bistro, (tx) => tx.select().from(businessDays));
    const orgIds = new Set(seen.map((d) => d.orgId));
    expect(orgIds).toEqual(new Set([bistro.orgId]));
    const cafeDays = await withTenant(database.db, bistro, (tx) =>
      tx.select().from(businessDays).where(eq(businessDays.orgId, cafe.orgId)),
    );
    expect(cafeDays).toHaveLength(0);
  });

  it("refuses to write a row into another group", async () => {
    await expectPgError(
      withTenant(database.db, bistro, (tx) =>
        tx.insert(exchangeRates).values({ orgId: cafe.orgId, lbpPerUsd: "1.0000", source: "custom" }),
      ),
      "42501",
    );
  });

  it("cannot read password hashes through the app role", async () => {
    await expectPgError(
      withTenant(database.db, cafe, (tx) => tx.select({ h: users.passwordHash }).from(users)),
      "42501",
    );
  });

  it("returns nothing for a day id from another group", async () => {
    const [cafeDay] = await database.db.select().from(businessDays).where(eq(businessDays.orgId, cafe.orgId)).limit(1);
    expect(await getDay(database.db, bistro, cafeDay.id)).toBeNull();
  });
});

describe("roles", () => {
  it("stops an accountant from recording expenses, in the app and in the database", async () => {
    const dash = await getDashboard(database.db, cafe);
    const open = dash.openDays[0];
    const day = (await getDay(database.db, cafe, open.id))!;
    await expect(
      addExpense(database.db, cafeAccountant, {
        dayId: open.id,
        categoryId: day.categories[0].id,
        description: "x",
        currency: "USD",
        amountMinor: 100n,
        paidFrom: "drawer",
      }),
    ).rejects.toThrow(UserError);
    // Bypass the app check: row-level security still refuses.
    await expectPgError(
      withTenant(database.db, cafeAccountant, (tx) =>
        tx.insert(expenses).values({
          orgId: cafe.orgId,
          locationId: day.day.locationId,
          businessDayId: open.id,
          expenseDate: day.day.businessDate,
          categoryId: day.categories[0].id,
          description: "sneaky",
          currency: "USD",
          amountMinor: 100n,
          paidFrom: "drawer",
          rateId: day.day.rateId,
        }),
      ),
      "42501",
    );
  });

  it("hides the audit trail from managers", async () => {
    const rows = await withTenant(database.db, cafe, (tx) => tx.select().from(auditLog).limit(5));
    expect(rows).toHaveLength(0);
    const ownerRows = await withTenant(database.db, cafeOwner, (tx) => tx.select().from(auditLog).limit(5));
    expect(ownerRows.length).toBeGreaterThan(0);
  });
});

describe("closed days", () => {
  it("are locked at the database level", async () => {
    const [closed] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.orgId, cafe.orgId), eq(businessDays.status, "closed")))
      .limit(1);
    await expectPgError(
      withTenant(database.db, cafe, (tx) =>
        tx.insert(salesLines).values({
          orgId: cafe.orgId,
          locationId: closed.locationId,
          businessDayId: closed.id,
          source: "manual",
          lineType: "payment",
          tender: "cash",
          currency: "USD",
          amountMinor: 100n,
        }),
      ),
      "P0001",
    );
    // Even the privileged connection can't edit or reopen it.
    await expectPgError(
      database.db.update(businessDays).set({ status: "open", closedAt: null }).where(eq(businessDays.id, closed.id)),
      "P0001",
    );
    await expectPgError(
      database.db.update(dayClosings).set({ note: "edited" }).where(eq(dayClosings.businessDayId, closed.id)),
      "P0001",
    );
  });

  it("accept corrections as adjustments from owners and accountants only", async () => {
    const [closed] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.orgId, cafe.orgId), eq(businessDays.status, "closed")))
      .limit(1);
    await addAdjustment(database.db, cafeAccountant, {
      dayId: closed.id,
      currency: "LBP",
      amountMinor: 1_790_000n,
      reason: "Plumber receipt found",
    });
    await expect(
      addAdjustment(database.db, cafe, { dayId: closed.id, currency: "USD", amountMinor: 100n, reason: "x" }),
    ).rejects.toThrow(UserError);
    const day = (await getDay(database.db, cafeOwner, closed.id))!;
    expect(day.adjustments).toHaveLength(1);
  });

  it("let the opening float be corrected only while open", async () => {
    const dash = await getDashboard(database.db, cafe);
    const open = dash.openDays[0];
    await setOpeningFloat(database.db, cafe, open.id, { USD: 15000n, LBP: 3_000_000n });
    const d = (await getDay(database.db, cafe, open.id))!;
    expect(d.breakdown.openingFloat).toEqual({ USD: 15000n, LBP: 3_000_000n });
    await expect(setOpeningFloat(database.db, cafeAccountant, open.id, { USD: 0n, LBP: 0n })).rejects.toThrow(UserError);
    const [closed] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.orgId, cafe.orgId), eq(businessDays.status, "closed")))
      .limit(1);
    await expect(setOpeningFloat(database.db, cafe, closed.id, { USD: 0n, LBP: 0n })).rejects.toThrow(/closed/);
  });

  it("can't be closed without both counts, and need a reason when they don't balance", async () => {
    const dash = await getDashboard(database.db, cafe);
    const open = dash.openDays[0];
    await expect(closeDay(database.db, cafe, open.id, {})).rejects.toThrow(/Count both/);
    await saveCount(database.db, cafe, { dayId: open.id, currency: "USD", denominations: {}, looseMinor: 0n });
    await saveCount(database.db, cafe, { dayId: open.id, currency: "LBP", denominations: {}, looseMinor: 0n });
    await expect(closeDay(database.db, cafe, open.id, {})).rejects.toThrow(/reason/);
    const recon = await closeDay(database.db, cafe, open.id, { reason: "other", note: "test" });
    expect(recon.withinTolerance).toBe(false);
    await expect(closeDay(database.db, cafe, open.id, { reason: "other" })).rejects.toThrow(/closed/);
  });
});

describe("history", () => {
  it("keeps each closed day on the rate it was closed with", async () => {
    const before = await withTenant(database.db, cafe, (tx) =>
      tx
        .select({ date: businessDays.businessDate, rate: exchangeRates.lbpPerUsd })
        .from(businessDays)
        .innerJoin(exchangeRates, eq(exchangeRates.id, businessDays.rateId))
        .orderBy(businessDays.businessDate),
    );
    const rates = new Set(before.map((r) => r.rate));
    expect(rates).toEqual(new Set(["89500.0000", "89700.0000"]));
    await setRate(database.db, cafeOwner, { lbpPerUsd: "90,000", source: "market" });
    const after = await withTenant(database.db, cafe, (tx) =>
      tx
        .select({ date: businessDays.businessDate, rate: exchangeRates.lbpPerUsd })
        .from(businessDays)
        .innerJoin(exchangeRates, eq(exchangeRates.id, businessDays.rateId))
        .orderBy(businessDays.businessDate),
    );
    expect(after).toEqual(before);
  });

  it("never lets rates or the audit log be rewritten", async () => {
    await expectPgError(database.db.update(exchangeRates).set({ lbpPerUsd: "1.0000" }), "P0001");
    await expectPgError(database.db.delete(auditLog), "P0001");
    await expectPgError(database.db.execute(sql`truncate audit_log`), "P0001");
  });

  it("records who did what", async () => {
    const rows = await withTenant(database.db, cafeOwner, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "exchange_rates"), eq(auditLog.userId, cafeOwner.userId))),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(parseRate((rows.at(-1)!.newData as { lbp_per_usd: string | number }).lbp_per_usd.toString())).toBe(
      parseRate("90000"),
    );
  });
});

describe("POS imports", () => {
  it("refuse the same POS record twice", async () => {
    const [day] = await database.db
      .select()
      .from(businessDays)
      .where(and(eq(businessDays.orgId, bistro.orgId)))
      .limit(1);
    // Use an open day: create one for tomorrow.
    const row = {
      orgId: bistro.orgId,
      locationId: day.locationId,
      source: "pos_import" as const,
      externalRef: "Z-0001-PAY-17",
      lineType: "payment" as const,
      tender: "card" as const,
      currency: "USD" as const,
      amountMinor: 1000n,
    };
    const [openDayRow] = await database.db
      .insert(businessDays)
      .values({ orgId: bistro.orgId, locationId: day.locationId, businessDate: "2099-01-01", rateId: day.rateId })
      .returning();
    const [batch] = await database.db
      .insert(posImports)
      .values({ orgId: bistro.orgId, locationId: day.locationId, fileName: "t.csv", fileHash: "x", headers: [], rows: [], rowCount: 0 })
      .returning();
    const line = { ...row, businessDayId: openDayRow.id, importId: batch.id };
    await withTenant(database.db, bistro, (tx) => tx.insert(salesLines).values(line));
    await expectPgError(withTenant(database.db, bistro, (tx) => tx.insert(salesLines).values(line)), "23505");
    // An imported line must belong to an import batch.
    await expectPgError(
      withTenant(database.db, bistro, (tx) =>
        tx.insert(salesLines).values({ ...row, externalRef: "Z-0002", businessDayId: openDayRow.id }),
      ),
      "23514",
    );
  });
});
