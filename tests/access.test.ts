// Phase 2 of the FINCTRL v2.0 spec: branches and access (sections 2.3, 14
// screen 8, 18, and acceptance test A).
//
// One business with three venues. Karim manages Hamra only; Nadine, the
// freelance accountant, was invited to Gemmayzeh and Mar Mikhael; Lara is a
// manager with no venues yet. Every check is made through the app's own
// functions and again straight against the database, as the app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { loadScope, migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { migrations } from "@/db/migrations";
import {
  dayClosings,
  exchangeRates,
  expenseCategories,
  expenses,
  locations,
  membershipLocations,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { toNotes } from "@/db/seed";
import { DEFAULT_CATEGORIES } from "@/lib/expense-buckets";
import { CURRENCIES, zeroPair } from "@/lib/money";
import { can, resolvePermissions } from "@/lib/permissions";
import { getEntryOptions } from "@/server/ledgers";
import {
  addAdjustment,
  addExpense,
  closeDay,
  getAuditTrail,
  getDashboard,
  getDay,
  listLocations,
  openDay,
  saveCount,
  saveManualSales,
  setRate,
  UserError,
} from "@/server/operations";
import { computePeriodReport, getPeriodReport } from "@/server/reports";
import {
  acceptInvite,
  addLocation,
  createInvite,
  getTeam,
  setLocationStatus,
  setMemberAccess,
  updateLocation,
} from "@/server/team";

let database: Database;
let orgId = "";
const ids = { rana: "", karim: "", nadine: "", lara: "" };
const venue = { gemmayzeh: "", hamra: "", marMikhael: "" };
const day = { gemmayzeh: "", hamra: "", marMikhael: "" };
let catId = "";

const scope = async (who: keyof typeof ids): Promise<TenantScope> => (await loadScope(database.db, ids[who], orgId))!;
const membershipOf = async (who: keyof typeof ids) =>
  (await database.db.select().from(memberships).where(and(eq(memberships.userId, ids[who]), eq(memberships.orgId, orgId))))[0];

function pgCode(e: unknown): string | undefined {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 5; i++) {
    if (cur.code) return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}
async function expectDenied(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(pgCode(e)).toBe("42501");
    return;
  }
  throw new Error("expected the database to refuse");
}

const zero = zeroPair;
const sales = {
  card: zero(),
  toters: zero(),
  noknok: zero(),
  other: zero(),
  cashRefunds: zero(),
  discounts: zero(),
  voids: zero(),
  tax: zero(),
  serviceCharge: zero(),
};

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  const db = database.db;
  const [org] = await db.insert(organizations).values({ name: "Access Test Group", plan: "multi" }).returning();
  orgId = org.id;
  const people = await db
    .insert(users)
    .values([
      { email: "rana@access.test", name: "Rana", passwordHash: "x" },
      { email: "karim@access.test", name: "Karim", passwordHash: "x" },
      { email: "nadine@access.test", name: "Nadine", passwordHash: "x" },
      { email: "lara@access.test", name: "Lara", passwordHash: "x" },
    ])
    .returning();
  [ids.rana, ids.karim, ids.nadine, ids.lara] = people.map((p) => p.id);
  const ms = await db
    .insert(memberships)
    .values([
      { userId: ids.rana, orgId, role: "owner" },
      { userId: ids.karim, orgId, role: "manager" },
      { userId: ids.nadine, orgId, role: "accountant" },
      { userId: ids.lara, orgId, role: "manager" },
    ])
    .returning();
  const locs = await db
    .insert(locations)
    .values([
      { orgId, name: "Gemmayzeh Bistro", venueType: "restaurant" },
      { orgId, name: "Hamra Roastery", venueType: "cafe" },
      { orgId, name: "Mar Mikhael Taproom", venueType: "pub" },
    ])
    .returning();
  [venue.gemmayzeh, venue.hamra, venue.marMikhael] = locs.map((l) => l.id);
  await db.insert(membershipLocations).values([
    { membershipId: ms[1].id, locationId: venue.hamra, orgId },
    { membershipId: ms[2].id, locationId: venue.gemmayzeh, orgId },
    { membershipId: ms[2].id, locationId: venue.marMikhael, orgId },
  ]);
  const cats = await db
    .insert(expenseCategories)
    .values(DEFAULT_CATEGORIES.map((name, i) => ({ orgId, name, position: i + 1 })))
    .returning();
  catId = cats[0].id;
  await db.insert(exchangeRates).values({ orgId, lbpPerUsd: "89700.0000", source: "market", effectiveAt: new Date("2026-10-01T00:00:00Z") });

  // The owner opens a day at each venue with some cash sales.
  const rana = await scope("rana");
  for (const key of ["gemmayzeh", "hamra", "marMikhael"] as const) {
    const d = await openDay(db, rana, { locationId: venue[key], businessDate: "2026-11-20", openingFloat: zero() });
    await saveManualSales(db, rana, d.id, { ...sales, cash: { USD: 10000n, LBP: 0n } });
    day[key] = d.id;
  }
});

afterAll(async () => {
  await database?.close();
});

// ---------------------------------------------------------------- test A

describe("Test A: branch isolation", () => {
  it("shows a manager only the venues assigned to them, everywhere", async () => {
    const karim = await scope("karim");
    const db = database.db;
    expect((await listLocations(db, karim)).map((l) => l.name)).toEqual(["Hamra Roastery"]);
    const dash = await getDashboard(db, karim, "2026-11-20");
    expect(dash.locations.map((l) => l.name)).toEqual(["Hamra Roastery"]);
    expect(dash.openDays.map((d) => d.id)).toEqual([day.hamra]);
    // The same read Daily Close and Performance use; row-level security limits it (managers don't open Performance by default).
    const report = await computePeriodReport(db, karim, { from: "2026-11-20", to: "2026-11-20" });
    expect(report.locations.map((l) => l.name)).toEqual(["Hamra Roastery"]);
    expect(report.cash.status.records).toBe(1);
    expect(report.totals.salesEq.collected).toBe(10000n);
    expect((await getEntryOptions(db, karim)).openDays.map((d) => d.id)).toEqual([day.hamra]);
  });

  it("shows an accountant only the venues they were invited to", async () => {
    const nadine = await scope("nadine");
    const report = await getPeriodReport(database.db, nadine, { from: "2026-11-20", to: "2026-11-20" });
    expect(report.locations.map((l) => l.name)).toEqual(["Gemmayzeh Bistro", "Mar Mikhael Taproom"]);
    expect(report.cash.status.records).toBe(2);
  });

  it("shows nothing to someone with no venues yet", async () => {
    const lara = await scope("lara");
    expect(await listLocations(database.db, lara)).toEqual([]);
    expect((await getDashboard(database.db, lara, "2026-11-20")).openDays).toEqual([]);
  });

  it("shows the owner every venue", async () => {
    expect(await listLocations(database.db, await scope("rana"))).toHaveLength(3);
  });

  it("can't reach another venue by changing an ID", async () => {
    const db = database.db;
    const karim = await scope("karim");
    expect(await getDay(db, karim, day.gemmayzeh)).toBeNull();
    await expect(openDay(db, karim, { locationId: venue.gemmayzeh, businessDate: "2026-11-21", openingFloat: zero() })).rejects.toThrow(UserError);
    await expect(
      addExpense(db, karim, { dayId: day.gemmayzeh, categoryId: catId, currency: "USD", amountMinor: 100n, paidFrom: "drawer" }),
    ).rejects.toThrow(UserError);
    await expect(computePeriodReport(db, karim, { from: "2026-11-20", to: "2026-11-20", locationId: venue.gemmayzeh })).rejects.toThrow(
      /doesn't exist/,
    );
  });

  it("is enforced by the database, not only the app", async () => {
    const db = database.db;
    const karim = await scope("karim");
    // Reading another venue's rows directly returns nothing.
    const seen = await withTenant(db, karim, (tx) => tx.select().from(locations));
    expect(seen.map((l) => l.id)).toEqual([venue.hamra]);
    const closings = await withTenant(db, karim, (tx) => tx.select().from(dayClosings));
    expect(closings).toEqual([]);
    // Writing into another venue is refused.
    const [rate] = await db.select().from(exchangeRates).where(eq(exchangeRates.orgId, orgId));
    await expectDenied(
      withTenant(db, karim, (tx) =>
        tx.insert(expenses).values({
          orgId,
          locationId: venue.gemmayzeh,
          businessDayId: day.gemmayzeh,
          expenseDate: "2026-11-20",
          categoryId: catId,
          description: "sneaky",
          currency: "USD",
          amountMinor: 100n,
          paidFrom: "bank",
          rateId: rate.id,
        }),
      ),
    );
  });

  it("rejects a scope for someone who isn't a member", async () => {
    const stranger: TenantScope = { orgId, userId: "00000000-0000-4000-8000-000000000000", role: "owner" };
    await expect(listLocations(database.db, stranger)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- permission matrix

describe("permission matrix (screen 8)", () => {
  it("gives each role the spec's defaults", () => {
    expect(resolvePermissions("owner", {}).length).toBeGreaterThan(5);
    expect(resolvePermissions("manager", {})).toEqual(["import_pos", "record_transactions", "close_days", "view_audit"]);
    expect(resolvePermissions("accountant", {})).toEqual(["view_reports", "export_reports", "view_audit"]);
  });

  it("ignores overrides the spec doesn't allow", () => {
    const acc = resolvePermissions("accountant", { close_days: true, change_rate: true, manage_team: true, post_corrections: true });
    expect(acc).toContain("post_corrections");
    expect(acc).not.toContain("close_days");
    expect(acc).not.toContain("change_rate");
    expect(acc).not.toContain("manage_team");
    expect(can({ role: "manager", permissions: resolvePermissions("manager", { manage_team: true }) }, "manage_team")).toBe(false);
  });

  it("keeps a manager off the exchange rate unless the owner allows it", async () => {
    const db = database.db;
    await expect(setRate(db, await scope("karim"), { lbpPerUsd: "90,000", source: "market" })).rejects.toThrow(UserError);
    await expectDenied(
      withTenant(db, await scope("karim"), (tx) => tx.insert(exchangeRates).values({ orgId, lbpPerUsd: "90000.0000", source: "market" })),
    );
    const m = await membershipOf("karim");
    await setMemberAccess(db, await scope("rana"), m.id, { locationIds: [venue.hamra], permissions: { change_rate: true } });
    await setRate(db, await scope("karim"), { lbpPerUsd: "89,700", source: "market" });
  });

  it("keeps an accountant read-only by default, with corrections and entries only when granted", async () => {
    const db = database.db;
    const nadine = await scope("nadine");
    await expect(
      addExpense(db, nadine, { dayId: day.marMikhael, categoryId: catId, currency: "USD", amountMinor: 100n, paidFrom: "bank" }),
    ).rejects.toThrow(UserError);

    // Close Mar Mikhael as the owner, short by $5, then try a correction.
    const rana = await scope("rana");
    const d = (await getDay(db, rana, day.marMikhael))!;
    for (const c of CURRENCIES) {
      const { notes, loose } = toNotes(d.breakdown.expected[c] - (c === "USD" ? 500n : 0n), c);
      await saveCount(db, rana, { dayId: day.marMikhael, currency: c, denominations: notes, looseMinor: loose });
    }
    await closeDay(db, rana, day.marMikhael, { reason: "counting_error", note: "Five dollars short." });
    await expect(addAdjustment(db, nadine, { dayId: day.marMikhael, currency: "USD", amountMinor: 500n, reason: "Found it" })).rejects.toThrow(
      UserError,
    );

    const m = await membershipOf("nadine");
    await setMemberAccess(db, rana, m.id, {
      locationIds: [venue.gemmayzeh, venue.marMikhael],
      permissions: { post_corrections: true, record_transactions: true },
    });
    const granted = await scope("nadine");
    await addAdjustment(db, granted, { dayId: day.marMikhael, currency: "USD", amountMinor: 500n, reason: "Found it in the safe bag" });
    await addExpense(db, granted, { dayId: day.gemmayzeh, categoryId: catId, currency: "USD", amountMinor: 100n, paidFrom: "bank", description: "Bank fee" });
  });

  it("never lets an accountant count or close a drawer, even with a stored override", async () => {
    const db = database.db;
    const m = await membershipOf("nadine");
    await db.update(memberships).set({ permissions: { ...(m.permissions as object), close_days: true } }).where(eq(memberships.id, m.id));
    const nadine = await scope("nadine");
    await expect(saveCount(db, nadine, { dayId: day.gemmayzeh, currency: "USD", denominations: {}, looseMinor: 0n })).rejects.toThrow(UserError);
    await expect(closeDay(db, nadine, day.gemmayzeh, {})).rejects.toThrow(UserError);
  });

  it("keeps Performance from managers unless an owner allows it, and never lets them download by default (v2.1)", async () => {
    const db = database.db;
    const karim = await scope("karim");
    expect(can(karim, "view_reports")).toBe(false);
    expect(can(karim, "export_reports")).toBe(false);
    await expect(getPeriodReport(db, karim, { from: "2026-11-01", to: "2026-11-30" })).rejects.toThrow(UserError);
    expect(can(await scope("nadine"), "export_reports")).toBe(true);
    // An owner can switch read-only Performance on for one manager.
    const m = await membershipOf("karim");
    await db.update(memberships).set({ permissions: { ...(m.permissions as object), view_reports: true } }).where(eq(memberships.id, m.id));
    const granted = await scope("karim");
    expect(can(granted, "view_reports")).toBe(true);
    expect(can(granted, "export_reports")).toBe(false);
    const report = await getPeriodReport(db, granted, { from: "2026-11-01", to: "2026-11-30" });
    expect(report.byLocation.map((l) => l.locationId)).not.toContain(venue.gemmayzeh);
    await db.update(memberships).set({ permissions: m.permissions }).where(eq(memberships.id, m.id));
  });

  it("keeps team management with owners", async () => {
    await expect(getTeam(database.db, await scope("karim"))).rejects.toThrow(UserError);
  });

  it("limits the audit trail to each person's venues and keeps team changes with owners", async () => {
    const db = database.db;
    const karimRows = (await getAuditTrail(db, await scope("karim"), 500)).rows;
    expect(karimRows.length).toBeGreaterThan(0);
    for (const r of karimRows) {
      expect(["memberships", "membership_locations", "invitations", "exchange_rates", "organizations"]).not.toContain(r.tableName);
    }
    const karimDays = karimRows.filter((r) => r.tableName === "business_days").map((r) => r.rowId);
    expect(karimDays).toContain(day.hamra);
    expect(karimDays).not.toContain(day.gemmayzeh);

    const nadineRows = (await getAuditTrail(db, await scope("nadine"), 500)).rows;
    expect(nadineRows.some((r) => r.tableName === "memberships" || r.tableName === "membership_locations")).toBe(false);
    expect(nadineRows.some((r) => r.tableName === "exchange_rates")).toBe(true); // business-wide, not team
    expect(nadineRows.filter((r) => r.tableName === "business_days").map((r) => r.rowId)).not.toContain(day.hamra);

    const ownerRows = (await getAuditTrail(db, await scope("rana"), 500)).rows;
    expect(ownerRows.some((r) => r.tableName === "membership_locations")).toBe(true);
  });
});

// ---------------------------------------------------------------- team & venues

describe("team access", () => {
  it("assigns venues only from this business and only to non-owners", async () => {
    const db = database.db;
    const rana = await scope("rana");
    const lara = await membershipOf("lara");
    await expect(
      setMemberAccess(db, rana, lara.id, { locationIds: ["00000000-0000-4000-8000-000000000000"], permissions: {} }),
    ).rejects.toThrow(UserError);
    await setMemberAccess(db, rana, lara.id, { locationIds: [venue.gemmayzeh], permissions: {} });
    expect((await listLocations(db, await scope("lara"))).map((l) => l.name)).toEqual(["Gemmayzeh Bistro"]);
    const team = await getTeam(db, rana);
    expect(team.members.find((m) => m.userId === ids.lara)!.locationIds).toEqual([venue.gemmayzeh]);
    expect(team.members.find((m) => m.userId === ids.rana)!.allLocations).toBe(true);
  });

  it("invites a manager or accountant to chosen venues, applied when they join", async () => {
    const db = database.db;
    const rana = await scope("rana");
    await expect(createInvite(db, rana, { email: "sami@access.test", role: "manager", locationIds: [] })).rejects.toThrow(/venue/i);
    const inv = await createInvite(db, rana, {
      email: "sami@access.test",
      role: "manager",
      locationIds: [venue.marMikhael],
      note: "Evening manager",
    });
    const joined = await acceptInvite(db, inv.token, { name: "Sami", password: "correct-horse-1" });
    const sami = (await loadScope(db, joined.userId, orgId))!;
    expect((await listLocations(db, sami)).map((l) => l.name)).toEqual(["Mar Mikhael Taproom"]);
  });

  it("keeps a new venue hidden from managers until they're assigned to it", async () => {
    const db = database.db;
    await addLocation(db, await scope("rana"), "Badaro Kitchen", "restaurant").catch((e) => {
      // The multi-branch plan allows 3 venues; lift the limit for this check.
      if (!(e instanceof UserError)) throw e;
    });
    await db.update(organizations).set({ plan: "enterprise" }).where(eq(organizations.id, orgId));
    const added = await addLocation(db, await scope("rana"), "Badaro Kitchen", "restaurant");
    expect(added.venueType).toBe("restaurant");
    expect((await listLocations(db, await scope("karim"))).map((l) => l.name)).toEqual(["Hamra Roastery"]);
  });
});

describe("venue details", () => {
  it("lets the owner set the venue type and business-day cutoff", async () => {
    const db = database.db;
    await updateLocation(db, await scope("rana"), venue.hamra, { name: "Hamra Roastery", venueType: "cafe", dayCutoffHour: 4 });
    const [hamra] = await db.select().from(locations).where(eq(locations.id, venue.hamra));
    expect(hamra.dayCutoffHour).toBe(4);
    await expect(updateLocation(db, await scope("karim"), venue.hamra, { name: "X", venueType: "pub", dayCutoffHour: 0 })).rejects.toThrow(
      UserError,
    );
    await expect(updateLocation(db, await scope("rana"), venue.hamra, { name: "Hamra Roastery", venueType: "cafe", dayCutoffHour: 13 })).rejects.toThrow(
      UserError,
    );
  });

  it("archives a venue only when it has no open day, and keeps its history", async () => {
    const db = database.db;
    const rana = await scope("rana");
    await expect(setLocationStatus(db, rana, venue.hamra, "archived")).rejects.toThrow(/open/i);
    // Mar Mikhael's only day was closed above.
    await setLocationStatus(db, rana, venue.marMikhael, "archived");
    await expect(openDay(db, rana, { locationId: venue.marMikhael, businessDate: "2026-11-22", openingFloat: zero() })).rejects.toThrow(/archived/i);
    const report = await getPeriodReport(db, rana, { from: "2026-11-20", to: "2026-11-20" });
    expect(report.daily.some((d) => d.locationId === venue.marMikhael)).toBe(true);
    await setLocationStatus(db, rana, venue.marMikhael, "active");
  });
});

// ---------------------------------------------------------------- migration

describe("migrating a business that existed before branch access", () => {
  it("keeps every existing manager and accountant on every venue, with what they could already do", async () => {
    const legacy = await openPglite();
    try {
      await legacy.inTransaction(async (tx) => {
        await tx.exec("create table _migrations (id text primary key, applied_at timestamptz not null default now())");
        for (const m of migrations.filter((m) => m.id < "0009")) {
          await tx.exec(m.sql);
          await tx.exec(`insert into _migrations (id) values ('${m.id}')`);
        }
      });
      const db = legacy.db;
      // Raw SQL: the tables don't have this phase's columns yet.
      const [org] = await legacy.query<{ id: string }>(`insert into organizations (name) values ('Legacy') returning id`);
      const [o, mg, ac] = await legacy.query<{ id: string }>(`
        insert into users (email, name, password_hash) values
          ('o@legacy.test', 'O', 'x'), ('m@legacy.test', 'M', 'x'), ('a@legacy.test', 'A', 'x')
        returning id`);
      await legacy.exec(`
        insert into memberships (user_id, org_id, role) values
          ('${o.id}', '${org.id}', 'owner'), ('${mg.id}', '${org.id}', 'manager'), ('${ac.id}', '${org.id}', 'accountant');
        insert into locations (org_id, name) values ('${org.id}', 'One'), ('${org.id}', 'Two');
      `);

      expect(await migrate(legacy)).toEqual(migrations.filter((m) => m.id >= "0009").map((m) => m.id));

      const assigned = await legacy.query<{ role: string; n: number }>(
        `select m.role, count(ml.*)::int as n from memberships m left join membership_locations ml on ml.membership_id = m.id group by m.role order by m.role`,
      );
      expect(assigned).toEqual([
        { role: "accountant", n: 2 },
        { role: "manager", n: 2 },
        { role: "owner", n: 0 },
      ]);
      const manager = (await loadScope(db, mg.id, org.id))!;
      const accountant = (await loadScope(db, ac.id, org.id))!;
      expect(can(manager, "change_rate")).toBe(true);
      expect(can(accountant, "post_corrections")).toBe(true);
      const [loc] = await legacy.query<{ venue_type: string; day_cutoff_hour: number; status: string }>(
        `select venue_type, day_cutoff_hour, status from locations limit 1`,
      );
      expect(loc).toEqual({ venue_type: "other", day_cutoff_hour: 5, status: "active" });
    } finally {
      await legacy.close();
    }
  });
});
