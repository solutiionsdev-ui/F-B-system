// The reads behind the Expenses, Cash and Cash Closing pages.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { locations, memberships, organizations, users } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { DEFAULT_CATEGORIES } from "@/lib/expense-buckets";
import { getEntryOptions, listMovements } from "@/server/ledgers";
import { addMovement, todayIn } from "@/server/operations";
import { shiftDate } from "@/server/reports";

let database: Database;
let manager: TenantScope;
let accountant: TenantScope;
const today = todayIn();
const month = { from: shiftDate(today, -30), to: today };

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await seedDemo(database.db);
  const scopeFor = async (email: string): Promise<TenantScope> => {
    const [row] = await database.db
      .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.email, email), eq(organizations.name, "Demo Café Group")));
    return row;
  };
  manager = await scopeFor("manager@demo.test");
  accountant = await scopeFor("accountant@demo.test");
});

afterAll(async () => {
  await database?.close();
});

describe("entry options", () => {
  it("lists the open days and the categories in order, for every role", async () => {
    for (const scope of [manager, accountant]) {
      const o = await getEntryOptions(database.db, scope);
      expect(o.openDays.map((d) => [d.locationName, d.date])).toEqual([["Hamra", today]]);
      expect(o.categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    }
  });
});

describe("cash movement list", () => {
  it("lists every movement in the period, newest first, typed and converted at the day's rate", async () => {
    const rows = await listMovements(database.db, accountant, month);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === "safe_drop" && r.direction === "out")).toBe(true);
    expect([...rows].map((r) => r.date)).toEqual(rows.map((r) => r.date).sort().reverse());
    // USD stays USD; nothing from the other group leaks in.
    for (const r of rows) if (r.currency === "USD") expect(r.eq).toBe(r.amountMinor);
    expect(rows.some((r) => r.locationName === "Mar Mikhael")).toBe(false);
  });

  it("converts LBP at the day's own rate and filters by location", async () => {
    const o = await getEntryOptions(database.db, manager);
    await addMovement(database.db, manager, {
      dayId: o.openDays[0].id,
      kind: "partner_withdrawal",
      currency: "LBP",
      amountMinor: 1_794_000n,
      partnerName: "Karim",
    });
    const [hamra] = await database.db.select().from(locations).where(eq(locations.name, "Hamra"));
    const rows = await listMovements(database.db, manager, { ...month, locationId: hamra.id });
    expect(rows.every((r) => r.locationName === "Hamra")).toBe(true);
    const w = rows.find((r) => r.kind === "partner_withdrawal")!;
    expect(w.dayOpen).toBe(true);
    expect(w.eq).toBe(2_000n); // 1,794,000 LBP at 89,700 = $20.00
    expect(w.partnerName).toBe("Karim");
    expect(w.rate).toBe(897_000_000n); // the rate locked on that business day, kept with the movement
    expect(w.enteredBy).toBe("Karim (Manager)");
  });

  it("refuses a bad period", async () => {
    await expect(listMovements(database.db, manager, { from: today, to: shiftDate(today, -1) })).rejects.toThrow(/before the start/);
  });
});
