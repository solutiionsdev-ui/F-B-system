// Past days from Excel: the template, reading the workbook, the preview of
// what each day becomes, posting through the Daily Close operations, and the
// guards (all or nothing, existing days untouched, owners only).
// Made-up figures only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { loadScope, migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { businessDays, cashMovements, dayClosings, dayImports, expenses, locations, organizations, users } from "@/db/schema";
import { historyTemplate, HISTORY_HEADERS } from "@/lib/history-template";
import { parseDate, readHistoryWorkbook } from "@/lib/history-workbook";
import { writeXlsx, type WriteSheet } from "@/lib/xlsx-writer";
import { createDayImport, discardDayImport, getDayImport, listDayImports, postDayImport } from "@/server/history";

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

const asSheets = (ws: WriteSheet[]) => ws.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map((c) => String(c ?? ""))) }));
/** The template with its example branch renamed, so its rows are imported instead of skipped. */
const templateFor = (branch: string) =>
  historyTemplate().map((s) => ({ ...s, rows: s.rows.map((r) => r.map((c) => (c === "Example – Main branch" ? branch : c))) }));
const upload = (sheets: WriteSheet[], fileName = "past-days.xlsx") => createDayImport(database.db, owner, { fileName, bytes: writeXlsx(sheets) });

type DayRow = Partial<Record<(typeof HISTORY_HEADERS.days)[number], string | number>>;
const workbook = (days: DayRow[], expenseRows: (string | number)[][] = [], movementRows: (string | number)[][] = []): WriteSheet[] => [
  { name: "Days", rows: [HISTORY_HEADERS.days, ...days.map((d) => HISTORY_HEADERS.days.map((h) => d[h] ?? ""))] },
  { name: "Expenses", rows: [HISTORY_HEADERS.expenses, ...expenseRows] },
  { name: "Cash movements", rows: [HISTORY_HEADERS.movements, ...movementRows] },
];

const cause = (e: unknown) => {
  const err = e as { message?: string; cause?: { message?: string } };
  return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
};

async function dayOf(branch: string, date: string) {
  const [loc] = await database.db.select().from(locations).where(and(eq(locations.orgId, owner.orgId), eq(locations.name, branch)));
  const [day] = await database.db
    .select()
    .from(businessDays)
    .where(and(eq(businessDays.locationId, loc.id), eq(businessDays.businessDate, date)));
  return day;
}

describe("reading a past-days workbook", () => {
  it("reads dates the way they're written in Lebanon, ISO dates and Excel serial dates", () => {
    expect(parseDate("2026-11-26")).toBe("2026-11-26");
    expect(parseDate("26/11/2026")).toBe("2026-11-26");
    expect(parseDate("3.11.26")).toBe("2026-11-03");
    expect(parseDate("45658")).toBe("2025-01-01");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });

  it("skips the template's example rows and says so", () => {
    const plan = readHistoryWorkbook(asSheets(historyTemplate()), "2026-11-28");
    expect(plan.days).toHaveLength(0);
    expect(plan.issues).toContainEqual(expect.objectContaining({ level: "info", message: expect.stringMatching(/^6 example rows/) }));
  });

  it("reads sales, float, count, expenses and movements in minor units, one currency at a time", () => {
    const plan = readHistoryWorkbook(asSheets(templateFor("Gemmayzeh Bistro")), "2026-11-28");
    expect(plan.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03"]);
    const [first, second] = plan.days;
    expect(first.float).toEqual({ USD: "15000", LBP: "2000000" });
    expect(first.sales.cash).toEqual({ USD: "42000", LBP: "3500000" });
    expect(first.counted).toEqual({ USD: "34000", LBP: "5050000" });
    expect(first.expenses.map((e) => [e.amount, e.currency, e.paidFrom])).toEqual([
      ["3000", "USD", "drawer"],
      ["450000", "LBP", "drawer"],
    ]);
    expect(first.movements).toEqual([expect.objectContaining({ kind: "safe_drop", amount: "20000", currency: "USD" })]);
    expect(second).toMatchObject({ reason: "unrecorded_expense", note: expect.stringMatching(/Plumber/) });
    expect(second.expenses[0]).toMatchObject({ paidFrom: "bank", amount: "12000" });
  });

  it("skips bad rows with a reason instead of guessing", () => {
    const plan = readHistoryWorkbook(
      asSheets(
        workbook(
          [
            { Date: "2026-11-05", Branch: "Hamra Roastery", "Cash USD": 100 },
            { Date: "2026-11-05", Branch: "Hamra Roastery", "Cash USD": 120 },
            { Date: "2026-12-30", Branch: "Hamra Roastery", "Cash USD": 100 },
            { Date: "soon", Branch: "Hamra Roastery", "Cash USD": 100 },
            { Date: "2026-11-06", Branch: "Hamra Roastery", "Cash USD": -5 },
          ],
          [
            ["2026-11-05", "Hamra Roastery", "Cleaning", 20, "USD", "Cash drawer", "", ""],
            ["2026-11-09", "Hamra Roastery", "Cleaning", 20, "USD", "Cash drawer", "", "Soap"],
          ],
          [["2026-11-05", "Hamra Roastery", "Partner withdrawal", 50, "USD", "", ""]],
        ),
      ),
      "2026-11-28",
    );
    expect(plan.days).toHaveLength(1);
    const messages = plan.issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(messages).toEqual([
      expect.stringMatching(/Same branch and date as row 2/),
      expect.stringMatching(/in the future/),
      expect.stringMatching(/isn't a date/),
      expect.stringMatching(/not a valid amount/),
      expect.stringMatching(/needs a note/),
      expect.stringMatching(/No matching row/),
      expect.stringMatching(/partner's name/),
    ]);
  });
});

describe("importing past days", () => {
  let importId = "";

  it("refuses a workbook that only has the examples", async () => {
    await expect(upload(historyTemplate())).rejects.toThrow(/no days in this workbook/);
  });

  it("previews each day with what Daily Close would expect, before saving anything", async () => {
    importId = await upload(templateFor("Gemmayzeh Bistro"));
    const preview = (await getDayImport(database.db, owner, importId))!;
    expect(preview.import.status).toBe("draft");
    expect(preview.counts).toEqual({ close_balanced: 1, close_flagged: 1, open: 0, skip: 0 });
    const [balanced, short] = preview.days;
    // USD 150 float + 420 cash − 30 bread − 200 safe drop; LBP 2,000,000 + 3,500,000 − 450,000 generator.
    expect(balanced).toMatchObject({ outcome: "close_balanced", expected: { USD: 34000n, LBP: 5050000n }, variance: { USD: 0n, LBP: 0n } });
    expect(balanced.collected).toEqual({ USD: 123000n, LBP: 3500000n });
    // The wages were paid by bank, so they don't change the drawer: USD 150 + 380 − 12 refund.
    expect(short).toMatchObject({ outcome: "close_flagged", expected: { USD: 51800n, LBP: 4900000n }, variance: { USD: -3800n, LBP: -100000n } });
    expect(await dayOf("Gemmayzeh Bistro", "2026-11-02")).toBeUndefined();
  });

  it("posts the days through the Daily Close rules: opened, recorded, counted, closed and locked", async () => {
    const summary = await postDayImport(database.db, owner, importId);
    expect(summary).toMatchObject({ closedBalanced: 1, closedFlagged: 1, leftOpen: 0, skipped: 0, expenses: 3, movements: 1 });
    const first = await dayOf("Gemmayzeh Bistro", "2026-11-02");
    const second = await dayOf("Gemmayzeh Bistro", "2026-11-03");
    expect([first.status, second.status]).toEqual(["closed", "closed"]);
    expect(first).toMatchObject({ openingFloatUsd: 15000n, openingFloatLbp: 2000000n });
    const closings = await database.db.select().from(dayClosings).where(inArray(dayClosings.businessDayId, [first.id, second.id]));
    const byDay = new Map(closings.map((c) => [c.businessDayId, c]));
    expect(byDay.get(first.id)).toMatchObject({ expectedUsd: 34000n, countedUsd: 34000n, varianceUsd: 0n, varianceLbp: 0n, withinTolerance: true, varianceReason: null });
    expect(byDay.get(second.id)).toMatchObject({
      varianceUsd: -3800n,
      varianceLbp: -100000n,
      withinTolerance: false,
      varianceReason: "unrecorded_expense",
      note: "Plumber paid from the drawer, receipt found later (imported from past-days.xlsx)",
    });
    const exp = await database.db.select().from(expenses).where(inArray(expenses.businessDayId, [first.id, second.id]));
    expect(exp.map((e) => e.description).sort()).toEqual(["Bread delivery", "Generator subscription, weekly", "Weekly wages"]);
    const mov = await database.db.select().from(cashMovements).where(eq(cashMovements.businessDayId, first.id));
    expect(mov).toHaveLength(1);
    await expect(postDayImport(database.db, owner, importId)).rejects.toThrow(/already posted/);
    await expect(discardDayImport(database.db, owner, importId)).rejects.toThrow(/hasn't been posted/);
  });

  it("never touches a day that already exists: uploading the same file again skips both days", async () => {
    const again = await upload(templateFor("Gemmayzeh Bistro"));
    const preview = (await getDayImport(database.db, owner, again))!;
    expect(preview.counts.skip).toBe(2);
    expect(preview.days[0].reasons[0]).toMatch(/already has a day/);
    await expect(postDayImport(database.db, owner, again)).rejects.toThrow(/every day in this workbook is skipped/);
    await discardDayImport(database.db, owner, again);
    expect((await listDayImports(database.db, owner)).map((i) => i.status)).toEqual(expect.arrayContaining(["posted", "discarded"]));
  });

  it("leaves a day open when it can't close honestly, and skips what it can't match", async () => {
    const id = await upload(
      workbook(
        [
          // No count: left open to count.
          { Date: "2026-11-04", Branch: "Hamra Roastery", "Opening float USD": 100, "Cash USD": 200 },
          // Short with no explanation: left open for someone to explain.
          { Date: "2026-11-05", Branch: "Hamra Roastery", "Opening float USD": 100, "Cash USD": 200, "Counted USD": 290, "Counted LBP": 0 },
          // Closed with nothing sold, but no note why: left open.
          { Date: "2026-11-06", Branch: "Hamra Roastery", "Opening float USD": 100, "Counted USD": 100, "Counted LBP": 0 },
          // Closed for a holiday, with a note: closes balanced.
          { Date: "2026-11-07", Branch: "Hamra Roastery", "Opening float USD": 100, "Counted USD": 100, "Counted LBP": 0, Note: "Closed for the holiday" },
          // A category that matches nothing: skipped.
          { Date: "2026-11-08", Branch: "Hamra Roastery", "Cash USD": 50, "Counted USD": 40, "Counted LBP": 0, Note: "x" },
          // A branch that doesn't exist: skipped.
          { Date: "2026-11-08", Branch: "Jounieh Pier", "Cash USD": 50, "Counted USD": 50, "Counted LBP": 0 },
        ],
        [
          // Matched by a common word ("Diesel" → Generator & Electricity), paid from the drawer.
          ["2026-11-04", "Hamra Roastery", "Diesel", 10, "USD", "Cash drawer", "", "Generator diesel"],
          ["2026-11-08", "Hamra Roastery", "Flowers", 10, "USD", "Cash drawer", "", "Table flowers"],
        ],
      ),
    );
    const preview = (await getDayImport(database.db, owner, id))!;
    const outcome = Object.fromEntries(preview.days.map((d) => [`${d.branch} ${d.date}`, [d.outcome, d.reasons[0] ?? ""]]));
    expect(outcome["Hamra Roastery 2026-11-04"]).toEqual(["open", expect.stringMatching(/No cash count/)]);
    expect(preview.days.find((d) => d.date === "2026-11-04")!.expected.USD).toBe(29000n);
    expect(outcome["Hamra Roastery 2026-11-05"]).toEqual(["open", expect.stringMatching(/Note is empty/)]);
    expect(outcome["Hamra Roastery 2026-11-06"]).toEqual(["open", expect.stringMatching(/No sales/)]);
    expect(outcome["Hamra Roastery 2026-11-07"]).toEqual(["close_balanced", ""]);
    expect(outcome["Hamra Roastery 2026-11-08"]).toEqual(["skip", expect.stringMatching(/"Flowers" doesn't match/)]);
    expect(outcome["Jounieh Pier 2026-11-08"]).toEqual(["skip", expect.stringMatching(/no branch called "Jounieh Pier"/)]);

    const summary = await postDayImport(database.db, owner, id);
    expect(summary).toMatchObject({ closedBalanced: 1, closedFlagged: 0, leftOpen: 3, skipped: 2, expenses: 1 });
    expect((await dayOf("Hamra Roastery", "2026-11-04")).status).toBe("open");
    expect((await dayOf("Hamra Roastery", "2026-11-07")).status).toBe("closed");
    expect(await dayOf("Hamra Roastery", "2026-11-08")).toBeUndefined();
    const [holiday] = await database.db.select().from(dayClosings).where(eq(dayClosings.businessDayId, (await dayOf("Hamra Roastery", "2026-11-07")).id));
    expect(holiday.noSalesReason).toBe("Closed for the holiday");
  });

  it("saves a file completely or not at all", async () => {
    // A database failure on the second day's expense must undo the first day too.
    await database.db.execute(sql`
      create function test_fail_expense() returns trigger language plpgsql as $$
      begin if new.description = 'FAIL ME' then raise exception 'simulated failure'; end if; return new; end $$`);
    await database.db.execute(sql`create trigger test_fail_expense before insert on expenses for each row execute function test_fail_expense()`);
    try {
      const id = await upload(
        workbook(
          [
            { Date: "2026-11-09", Branch: "Mar Mikhael Taproom", "Cash USD": 80, "Counted USD": 80, "Counted LBP": 0 },
            { Date: "2026-11-10", Branch: "Mar Mikhael Taproom", "Cash USD": 90, "Counted USD": 80, "Counted LBP": 0, Note: "Paid the plumber" },
          ],
          [["2026-11-10", "Mar Mikhael Taproom", "Maintenance", 10, "USD", "Cash drawer", "", "FAIL ME"]],
        ),
      );
      const err = await postDayImport(database.db, owner, id).catch((e) => e);
      expect(cause(err)).toMatch(/simulated failure/);
      expect(await dayOf("Mar Mikhael Taproom", "2026-11-09")).toBeUndefined();
      const [imp] = await database.db.select().from(dayImports).where(eq(dayImports.id, id));
      expect(imp.status).toBe("draft");
    } finally {
      await database.db.execute(sql`drop trigger test_fail_expense on expenses`);
      await database.db.execute(sql`drop function test_fail_expense()`);
    }
  });

  it("is for owners only, in the app and in the database", async () => {
    const bytes = writeXlsx(templateFor("Gemmayzeh Bistro"));
    await expect(createDayImport(database.db, manager, { fileName: "x.xlsx", bytes })).rejects.toThrow(/Only owners/);
    await expect(getDayImport(database.db, manager, importId)).rejects.toThrow(/Only owners/);
    await expect(postDayImport(database.db, manager, importId)).rejects.toThrow(/Only owners/);
    const seen = await withTenant(database.db, manager, (tx) => tx.select({ id: dayImports.id }).from(dayImports));
    expect(seen).toHaveLength(0);
    const err = await withTenant(database.db, manager, (tx) =>
      tx.insert(dayImports).values({ orgId: manager.orgId, fileName: "x.xlsx", fileHash: "x", plan: { days: [], issues: [] }, createdBy: manager.userId }),
    ).catch((e) => e);
    expect(cause(err)).toMatch(/row-level security|permission denied/);
  });

  it("keeps an uploaded workbook frozen, and a posted one final", async () => {
    // The app's role can only change the status columns...
    const err = await withTenant(database.db, owner, (tx) => tx.update(dayImports).set({ plan: { days: [], issues: [] } }).where(eq(dayImports.id, importId))).catch((e) => e);
    expect(cause(err)).toMatch(/permission denied/);
    // ...and underneath, the table refuses any change to the workbook or to a posted import, whoever asks.
    const frozen = await database.db.update(dayImports).set({ plan: { days: [], issues: [] } }).where(eq(dayImports.id, importId)).catch((e) => e);
    expect(cause(frozen)).toMatch(/cannot be changed/);
    const final = await database.db.update(dayImports).set({ status: "draft" }).where(eq(dayImports.id, importId)).catch((e) => e);
    expect(cause(final)).toMatch(/already posted/);
  });
});
