// The two buckets for money going out:
//   A. operating expenses (reduce profit), paid from the cash drawer or by bank / Whish
//   B. cash movements (safe drops, bank deposits, partner withdrawals), which move cash
//      but are never counted as expenses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { migrations } from "@/db/migrations";
import { businessDays, cashMovements, expenseCategories, memberships, organizations, users } from "@/db/schema";
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
  it("offers the new categories in order", async () => {
    const day = (await getDay(database.db, manager, (await openDay()).id))!;
    expect(day.categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
  });

  it("only drawer expenses change the expected cash; notes are optional and a receipt number is kept", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    const salaries = before.categories.find((c) => c.name === "Salaries & Wages")!;

    await addExpense(database.db, manager, {
      dayId: open.id,
      categoryId: salaries.id,
      currency: "USD",
      amountMinor: 30_000n,
      paidFrom: "bank",
      receiptRef: "W-1182",
    });
    const afterBank = (await getDay(database.db, manager, open.id))!;
    expect(afterBank.breakdown.expected).toEqual(before.breakdown.expected);
    const bank = afterBank.expenses.at(-1)!;
    expect(bank.description).toBe("");
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
      addExpense(database.db, manager, { dayId: open.id, categoryId: cat.id, currency: "USD", amountMinor: 100n, paidFrom: "drawer" }),
    ).rejects.toThrow(/categories in the list/);
  });
});

describe("cash movements (bucket B)", () => {
  it("a partner withdrawal lowers the drawer but is never an expense", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    const filter = { from: open.businessDate, to: open.businessDate, locationId: open.locationId };
    const reportBefore = await getPeriodReport(database.db, owner, filter);

    await addMovement(database.db, manager, {
      dayId: open.id,
      kind: "partner_withdrawal",
      currency: "USD",
      amountMinor: 10_000n,
      reason: "Karim",
    });

    const after = (await getDay(database.db, manager, open.id))!;
    expect(after.breakdown.expected.USD).toBe(before.breakdown.expected.USD - 10_000n);
    const [row] = await database.db
      .select()
      .from(cashMovements)
      .where(and(eq(cashMovements.businessDayId, open.id), eq(cashMovements.kind, "partner_withdrawal")));
    expect(row.direction).toBe("out");

    const report = await getPeriodReport(database.db, owner, filter);
    expect(report.totals.expensesEq).toBe(reportBefore.totals.expensesEq);
    const withdrawals = report.movements.find((m) => m.kind === "partner_withdrawal")!;
    expect(withdrawals.pair.USD - (reportBefore.movements.find((m) => m.kind === "partner_withdrawal")?.pair.USD ?? 0n)).toBe(10_000n);
  });

  it("cash added to the drawer raises the expected cash", async () => {
    const open = await openDay();
    const before = (await getDay(database.db, manager, open.id))!;
    await addMovement(database.db, manager, { dayId: open.id, kind: "top_up", currency: "LBP", amountMinor: 500_000n });
    const after = (await getDay(database.db, manager, open.id))!;
    expect(after.breakdown.expected.LBP).toBe(before.breakdown.expected.LBP + 500_000n);
  });

  it("needs a note for other cash taken out, and a type the app knows", async () => {
    const open = await openDay();
    await expect(
      addMovement(database.db, manager, { dayId: open.id, kind: "other", currency: "USD", amountMinor: 100n, reason: " " }),
    ).rejects.toThrow(/what the cash was taken out for/);
    await expect(
      addMovement(database.db, manager, { dayId: open.id, kind: "bonus" as never, currency: "USD", amountMinor: 100n }),
    ).rejects.toThrow(/what kind of cash movement/);
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
      expect(active.find((c) => c.name === "Miscellaneous")!.id).toBe(idOf("Other"));
      expect(active.find((c) => c.name === "Marketing")!.id).toBe(idOf("Marketing"));
      expect(after.filter((c) => c.archived).map((c) => c.name).sort()).toEqual(
        ["Delivery & transport", "Electricity (EDL)", "Gas & fuel", "Staff advances", "Water"].sort(),
      );
    } finally {
      await legacy.close();
    }
  });
});
