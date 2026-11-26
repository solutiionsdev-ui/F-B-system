// The two buckets for money going out:
//   A. operating expenses (reduce profit), paid from the cash drawer or by bank / Whish
//   B. cash movements (safe drops, bank deposits, partner withdrawals), which move cash
//      but are never counted as expenses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { migrations } from "@/db/migrations";
import { businessDays, cashMovements, expenseCategories, expenses, memberships, organizations, users } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { DEFAULT_CATEGORIES, movementKindOf } from "@/lib/expense-buckets";
import { addExpense, addMovement, getDay } from "@/server/operations";
import { getPeriodReport } from "@/server/reports";

let database: Database;
let manager: TenantScope;
let owner: TenantScope;

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
  owner = await scopeFor("owner@demo.test");
});

afterAll(async () => {
  await database?.close();
});

async function openDay() {
  const [day] = await database.db
    .select()
    .from(businessDays)
    .where(and(eq(businessDays.orgId, manager.orgId), eq(businessDays.status, "open")))
    .limit(1);
  return day;
}

describe("operating expenses (bucket A)", () => {
  it("offers the eight universal categories in order", async () => {
    const day = (await getDay(database.db, manager, (await openDay()).id))!;
    expect(day.categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
  });

  it("only drawer expenses change the expected cash; notes are required and a receipt number is kept", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    const salaries = before.categories.find((c) => c.name === "Salaries & Wages")!;

    const bankPaid = { dayId: open.id, categoryId: salaries.id, currency: "USD" as const, amountMinor: 30_000n, paidFrom: "bank" as const, receiptRef: "W-1182" };
    await expect(addExpense(database.db, manager, bankPaid)).rejects.toThrow(/note/i);
    await expect(addExpense(database.db, manager, { ...bankPaid, description: "   " })).rejects.toThrow(/note/i);
    await addExpense(database.db, manager, { ...bankPaid, description: "November salaries, first half" });
    const afterBank = (await getDay(database.db, manager, open.id))!;
    expect(afterBank.breakdown.expected).toEqual(before.breakdown.expected);
    const bank = afterBank.expenses.at(-1)!;
    expect(bank.description).toBe("November salaries, first half");
    expect(bank.receiptRef).toBe("W-1182");
    expect(bank.paidFrom).toBe("bank");

    await addExpense(database.db, manager, {
      dayId: open.id,
      categoryId: salaries.id,
      description: "Saturday shift wages",
      currency: "LBP",
      amountMinor: 900_000n,
      paidFrom: "drawer",
    });
    const afterDrawer = (await getDay(database.db, manager, open.id))!;
    expect(afterDrawer.breakdown.expected.LBP).toBe(before.breakdown.expected.LBP - 900_000n);
    expect(afterDrawer.breakdown.expected.USD).toBe(before.breakdown.expected.USD);
  });

  it("refuses an archived category", async () => {
    const open = await openDay();
    const [cat] = await database.db
      .insert(expenseCategories)
      .values({ orgId: manager.orgId, name: "Old category", archived: true })
      .returning();
    await expect(
      addExpense(database.db, manager, { dayId: open.id, categoryId: cat.id, description: "x", currency: "USD", amountMinor: 100n, paidFrom: "drawer" }),
    ).rejects.toThrow(/categories in the list/);
  });

  it("reports an expense in a folded category under the universal one, keeping the original", async () => {
    const open = await openDay();
    const cats = await database.db.select().from(expenseCategories).where(eq(expenseCategories.orgId, manager.orgId));
    const target = cats.find((c) => c.name === "Cleaning, Maintenance & Repairs")!;
    const [old] = await database.db
      .insert(expenseCategories)
      .values({ orgId: manager.orgId, name: "Cleaning", archived: true, rollsUpTo: target.id })
      .returning();
    const [any] = await database.db.select().from(expenses).where(eq(expenses.businessDayId, open.id)).limit(1);
    await database.db.insert(expenses).values({
      orgId: manager.orgId,
      locationId: open.locationId,
      businessDayId: open.id,
      expenseDate: open.businessDate,
      categoryId: old.id,
      description: "Detergent, entered before the categories changed",
      currency: "USD",
      amountMinor: 1_200n,
      paidFrom: "bank",
      rateId: any.rateId,
    });
    const report = await getPeriodReport(database.db, owner, { from: open.businessDate, to: open.businessDate, locationId: open.locationId });
    const row = report.expenses.find((e) => e.description.startsWith("Detergent, entered before"))!;
    expect(row.category).toBe("Cleaning, Maintenance & Repairs");
    expect(row.originalCategory).toBe("Cleaning");
    expect(report.categories.some((c) => c.name === "Cleaning")).toBe(false);
  });
});

describe("cash movements (bucket B)", () => {
  it("a partner withdrawal names the partner, lowers the drawer and is never an expense", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    const filter = { from: open.businessDate, to: open.businessDate, locationId: open.locationId };
    const reportBefore = await getPeriodReport(database.db, owner, filter);

    const withdrawal = { dayId: open.id, kind: "partner_withdrawal" as const, currency: "USD" as const, amountMinor: 10_000n };
    await expect(addMovement(database.db, manager, withdrawal)).rejects.toThrow(/partner's name/i);
    await addMovement(database.db, manager, { ...withdrawal, partnerName: "  Karim   Haddad " });

    const after = (await getDay(database.db, manager, open.id))!;
    expect(after.breakdown.expected.USD).toBe(before.breakdown.expected.USD - 10_000n);
    const [row] = await database.db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.businessDayId, open.id), eq(cashMovements.kind, "partner_withdrawal")));
    expect(row.direction).toBe("out");
    expect(row.partnerName).toBe("Karim Haddad");

    const report = await getPeriodReport(database.db, owner, filter);
    expect(report.totals.expensesEq).toBe(reportBefore.totals.expensesEq);
    const withdrawals = report.movements.find((m) => m.kind === "partner_withdrawal")!;
    expect(withdrawals.pair.USD - (reportBefore.movements.find((m) => m.kind === "partner_withdrawal")?.pair.USD ?? 0n)).toBe(10_000n);
  });

  it("an opening float adjustment changes the adjusted float once and keeps the original", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    const adjust = { dayId: open.id, kind: "float_adjustment" as const, currency: "LBP" as const };

    await expect(addMovement(database.db, manager, { ...adjust, amountMinor: 500_000n, direction: "in" })).rejects.toThrow(/reason/i);
    await expect(addMovement(database.db, manager, { ...adjust, amountMinor: 500_000n, reason: "Recount" })).rejects.toThrow(/adds to|reduces/i);
    await addMovement(database.db, manager, { ...adjust, amountMinor: 500_000n, direction: "in", reason: "Float recounted before service" });
    const added = (await getDay(database.db, manager, open.id))!;
    expect(added.breakdown.openingFloat).toEqual(before.breakdown.openingFloat); // the original is kept
    expect(added.breakdown.floatAdjustments.LBP).toBe(before.breakdown.floatAdjustments.LBP + 500_000n);
    expect(added.breakdown.adjustedFloat.LBP).toBe(before.breakdown.adjustedFloat.LBP + 500_000n);
    expect(added.breakdown.expected.LBP).toBe(before.breakdown.expected.LBP + 500_000n); // counted exactly once
    expect(added.breakdown.movementsIn).toEqual(before.breakdown.movementsIn); // and not as a second movement

    await addMovement(database.db, manager, { ...adjust, amountMinor: 200_000n, direction: "out", reason: "Two notes were torn" });
    const reduced = (await getDay(database.db, manager, open.id))!;
    expect(reduced.breakdown.expected.LBP).toBe(before.breakdown.expected.LBP + 300_000n);
    await expect(
      addMovement(database.db, manager, { ...adjust, amountMinor: 999_000_000n, direction: "out", reason: "Too much" }),
    ).rejects.toThrow(/below zero/);

    // Never an expense, and the float a day was opened with can't be overwritten, even from the database.
    const report = await getPeriodReport(database.db, owner, { from: open.businessDate, to: open.businessDate, locationId: open.locationId });
    expect(report.movements.find((m) => m.kind === "float_adjustment")!.pair.LBP).toBe(300_000n);
    await expect(database.db.update(businessDays).set({ openingFloatLbp: 1n }).where(eq(businessDays.id, open.id))).rejects.toThrow();
  });

  it("offers only the spec's three movement types", async () => {
    const open = await openDay();
    for (const kind of ["top_up", "other"] as const) {
      await expect(
        addMovement(database.db, manager, { dayId: open.id, kind, currency: "USD", amountMinor: 100n, reason: "x" }),
      ).rejects.toThrow(/safe drop|partner withdrawal|float adjustment/i);
    }
    await expect(
      addMovement(database.db, manager, { dayId: open.id, kind: "bonus" as never, currency: "USD", amountMinor: 100n }),
    ).rejects.toThrow(/what kind of cash movement/);
    await addMovement(database.db, manager, { dayId: open.id, kind: "safe_drop", currency: "USD", amountMinor: 5_000n });
  });

  it("the database keeps a movement's type and direction consistent", async () => {
    const open = await openDay();
    await expect(
      database.db.insert(cashMovements).values({
        orgId: open.orgId,
        businessDayId: open.id,
        kind: "top_up",
        direction: "out",
        currency: "USD",
        amountMinor: 100n,
        reason: "",
      }),
    ).rejects.toThrow();
    // A float adjustment always carries its reason.
    await expect(
      database.db.insert(cashMovements).values({
        orgId: open.orgId,
        businessDayId: open.id,
        kind: "float_adjustment",
        direction: "in",
        currency: "USD",
        amountMinor: 100n,
        reason: " ",
      }),
    ).rejects.toThrow();
  });

  it("works out the type of movements recorded before types existed", () => {
    expect(movementKindOf({ kind: null, direction: "out", reason: "Safe drop" })).toBe("safe_drop");
    expect(movementKindOf({ kind: null, direction: "out", reason: "Bank deposit" })).toBe("safe_drop");
    expect(movementKindOf({ kind: null, direction: "out", reason: "Owner withdrawal" })).toBe("partner_withdrawal");
    expect(movementKindOf({ kind: null, direction: "in", reason: "Change from the bank" })).toBe("top_up");
    expect(movementKindOf({ kind: null, direction: "out", reason: "Paid the plumber" })).toBe("other");
    expect(movementKindOf({ kind: "partner_withdrawal", direction: "out", reason: "Safe" })).toBe("partner_withdrawal");
  });
});

describe("migrating an organisation that has the old categories", () => {
  it("renames what maps cleanly, archives the rest and orders the new list", async () => {
    const legacy = await openPglite();
    try {
      const before = migrations.filter((m) => m.id < "0007");
      await legacy.inTransaction(async (tx) => {
        await tx.exec("create table _migrations (id text primary key, applied_at timestamptz not null default now())");
        for (const m of before) {
          await tx.exec(m.sql);
          await tx.exec(`insert into _migrations (id) values ('${m.id}')`);
        }
      });
      // Plain SQL: the typed schema already knows the columns 0007 adds.
      const [org] = await legacy.query<{ id: string }>("insert into organizations (name) values ('Old Org') returning id");
      const old = [
        "Food supplies",
        "Beverages",
        "Generator subscription",
        "Electricity (EDL)",
        "Water",
        "Gas & fuel",
        "Cleaning supplies",
        "Maintenance",
        "Delivery & transport",
        "Staff advances",
        "Rent",
        "Other",
        "Marketing", // already added by hand
      ];
      const rows = await legacy.query<{ id: string; name: string }>(
        `insert into expense_categories (org_id, name) values ${old.map((n) => `('${org.id}', '${n}')`).join(", ")} returning id, name`,
      );
      const idOf = (name: string) => rows.find((r) => r.name === name)!.id;

      expect(await migrate(legacy)).toEqual(migrations.filter((m) => m.id >= "0007").map((m) => m.id));

      const after = await legacy.db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.orgId, org.id))
        .orderBy(asc(expenseCategories.position), asc(expenseCategories.name));
      const active = after.filter((c) => !c.archived);
      expect(active.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
      // Renamed in place, so past expenses move with them.
      expect(active.find((c) => c.name === "Food & Kitchen Suppliers")!.id).toBe(idOf("Food supplies"));
      expect(active.find((c) => c.name === "Beverage, Coffee & Bar Suppliers")!.id).toBe(idOf("Beverages"));
      expect(active.find((c) => c.name === "Cleaning, Maintenance & Repairs")!.id).toBe(idOf("Maintenance"));
      expect(active.find((c) => c.name === "Miscellaneous / Petty Cash")!.id).toBe(idOf("Other"));
      const archived = after.filter((c) => c.archived);
      expect(archived.map((c) => c.name).sort()).toEqual(
        ["Cleaning", "Delivery & transport", "Electricity (EDL)", "Gas & fuel", "Marketing", "Staff advances", "Water"].sort(),
      );
      // Folded categories point at the universal one their expenses are reported under.
      expect(archived.find((c) => c.name === "Cleaning")!.rollsUpTo).toBe(idOf("Maintenance"));
      expect(archived.find((c) => c.name === "Marketing")!.rollsUpTo).toBe(idOf("Other"));
      expect(archived.find((c) => c.name === "Water")!.rollsUpTo).toBeNull();
    } finally {
      await legacy.close();
    }
  });
});
