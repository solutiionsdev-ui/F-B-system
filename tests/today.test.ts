import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { seedDemo } from "@/db/seed";
import { locations, memberships, organizations, posImports, users } from "@/db/schema";
import { closeDay, getDashboard, saveCount, todayIn, UserError } from "@/server/operations";
import { createImportDraft, discardImport, postImport } from "@/server/pos-import";
import { getToday } from "@/server/today";

let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;
let hamraId: string;
let gemmayzehId: string;

const SAMPLE = readFileSync("public/samples/sample-pos-export.csv").toString("utf8");
const sampleFor = (date: string) => {
  const [y, m, d] = date.split("-");
  return new TextEncoder().encode(SAMPLE.replaceAll("24/11/2026", `${d}/${m}/${y}`).replaceAll("25/11/2026", `${d}/${m}/${y}`));
};

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
  owner = await scopeFor("owner@demo.test");
  manager = await scopeFor("manager@demo.test");
  accountant = await scopeFor("accountant@demo.test");
  const locs = await database.db.select().from(locations).where(eq(locations.orgId, owner.orgId));
  hamraId = locs.find((l) => l.name === "Hamra")!.id;
  gemmayzehId = locs.find((l) => l.name === "Gemmayzeh")!.id;
});

afterAll(async () => {
  await database?.close();
});

describe("health strips", () => {
  it("give every location 14 days, newest last", async () => {
    const t = await getToday(database.db, owner);
    const hamra = t.health[hamraId];
    expect(hamra).toHaveLength(14);
    expect(hamra.at(-1)!.date).toBe(todayIn());
    expect(hamra.at(-1)!.state).toBe("open");
    expect(hamra.filter((x) => x.state === "short")).toHaveLength(1);
    expect(t.health[gemmayzehId].at(-1)!.state).toBe("none");
  });
});

describe("needs you", () => {
  it("offers the quickest next step for each item", async () => {
    const t = await getToday(database.db, manager);
    const notOpen = t.info.find((i) => i.key === `notopen-${gemmayzehId}`)!;
    expect(notOpen.actions.map((a) => a.kind)).toEqual(["open", "link"]);
    const openToday = t.needs.find((i) => i.key.startsWith("open-"))!;
    expect(openToday.actions[0]).toMatchObject({ kind: "link", label: "Count now" });
  });

  it("shows unbalanced days to owners and accountants, not managers", async () => {
    const forManager = await getToday(database.db, manager);
    const forAccountant = await getToday(database.db, accountant);
    expect(forManager.needs.some((i) => i.key.startsWith("flag-"))).toBe(false);
    expect(forAccountant.needs.some((i) => i.key.startsWith("flag-"))).toBe(true);
    expect(forAccountant.info.some((i) => i.key.startsWith("notopen-"))).toBe(false);
  });

  it("lets a clean draft be imported in one click, and any draft be discarded", async () => {
    const clean = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "clean.csv", bytes: sampleFor("2026-12-10") });
    const t = await getToday(database.db, manager);
    const item = t.info.find((i) => i.key === `draft-${clean}`)!;
    expect(item.actions.map((a) => a.kind)).toEqual(["import", "link", "discard"]);

    await discardImport(database.db, manager, clean);
    const [gone] = await database.db.select().from(posImports).where(eq(posImports.id, clean));
    expect(gone).toBeUndefined();
  });
});

describe("discarding imports", () => {
  it("only removes drafts, and only for owners and managers", async () => {
    const id = await createImportDraft(database.db, manager, { locationId: gemmayzehId, fileName: "x.csv", bytes: sampleFor("2026-12-11") });
    await expect(discardImport(database.db, accountant, id)).rejects.toThrow(UserError);
    // Bypassing the app check: row-level security deletes nothing.
    await withTenant(database.db, accountant, (tx) => tx.delete(posImports).where(eq(posImports.id, id)));
    expect(await database.db.select().from(posImports).where(eq(posImports.id, id))).toHaveLength(1);

    await postImport(database.db, manager, id, { createMissingDays: true });
    await expect(discardImport(database.db, owner, id)).rejects.toThrow(/Undo a posted import/);
    await withTenant(database.db, owner, (tx) => tx.delete(posImports).where(eq(posImports.id, id)));
    expect(await database.db.select().from(posImports).where(eq(posImports.id, id))).toHaveLength(1);
  });
});

describe("insights", () => {
  it("call out a location that keeps coming up short", async () => {
    const before = await getToday(database.db, owner);
    expect(before.insights.some((i) => i.key === `short-${hamraId}`)).toBe(false);

    // Close today's Hamra day with an empty drawer: a second short day.
    const dash = await getDashboard(database.db, manager);
    const open = dash.openDays.find((d) => d.locationId === hamraId)!;
    await saveCount(database.db, manager, { dayId: open.id, currency: "USD", denominations: {}, looseMinor: 0n });
    await saveCount(database.db, manager, { dayId: open.id, currency: "LBP", denominations: {}, looseMinor: 0n });
    await closeDay(database.db, manager, open.id, { reason: "suspected_loss", note: "The drawer was empty at closing." });

    const after = await getToday(database.db, owner);
    const insight = after.insights.find((i) => i.key === `short-${hamraId}`)!;
    expect(insight.lead).toBe("Hamra came up short 2 times in the last 14 days.");
    expect(insight.action?.href).toContain(`location=${hamraId}`);
    // Managers don't open Performance by default (v2.1), so their link goes to the day itself.
    const forManager = await getToday(database.db, manager);
    expect(forManager.insights.find((i) => i.key === `short-${hamraId}`)!.action?.href).toMatch(/^\/days\//);
    expect(after.insights.length).toBeLessThanOrEqual(2);
  });
});
