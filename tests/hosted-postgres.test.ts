// Hosted Postgres (Neon, Supabase, RDS) doesn't give the app a superuser:
// the app logs in as an ordinary role that owns the tables. This runs every
// migration, the demo seed and the app's own queries as such a role, so a
// launch can't fail on permissions that a superuser would have hidden.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { seedDemo } from "@/db/seed";
import { businessDays, memberships, organizations, sessions, users } from "@/db/schema";
import { getDashboard } from "@/server/operations";
import { getPeriodReport, shiftDate } from "@/server/reports";
import { todayIn } from "@/server/operations";

let database: Database;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    create role app_owner login createrole;
    grant create on schema public to app_owner;
    set role app_owner;
  `);
  database = await openPglite(pg);
});

afterAll(async () => {
  await database?.close();
});

describe("as an ordinary (non-superuser) owner login", () => {
  it("really isn't a superuser and can't bypass row-level security", async () => {
    const [me] = await database.query<{ rolsuper: boolean; rolbypassrls: boolean; name: string }>(
      "select rolname as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(me).toEqual({ name: "app_owner", rolsuper: false, rolbypassrls: false });
  });

  it("runs every migration, and running again changes nothing", async () => {
    const applied = await migrate(database);
    expect(applied.length).toBeGreaterThanOrEqual(6);
    expect(await migrate(database)).toEqual([]);
  });

  it("seeds the demo data", async () => {
    await seedDemo(database.db);
    const orgs = await database.db.select().from(organizations);
    expect(orgs.map((o) => o.name).sort()).toEqual(["Demo Bistro", "Demo Café Group"]);
  });

  it("can look users up for sign-in and store sessions", async () => {
    const [u] = await database.db.select().from(users).where(eq(users.email, "owner@demo.test"));
    expect(u?.name).toBe("Rana (Owner)");
    await database.db.insert(sessions).values({ id: "test-session", userId: u.id, expiresAt: new Date(Date.now() + 60_000) });
    const ms = await database.db.select().from(memberships).where(eq(memberships.userId, u.id));
    expect(ms).toHaveLength(1);
  });

  it("would hide every user from sign-in if row-level security were forced (why 0006 exists)", async () => {
    await database.exec("alter table users force row level security");
    const hidden = await database.db.select().from(users).where(eq(users.email, "owner@demo.test"));
    await database.exec("alter table users no force row level security");
    expect(hidden).toHaveLength(0);
  });

  it("still isolates restaurant groups for tenant requests", async () => {
    const scopeFor = async (email: string, orgName: string): Promise<TenantScope> => {
      const [row] = await database.db
        .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(and(eq(users.email, email), eq(organizations.name, orgName)));
      return row;
    };
    const cafe = await scopeFor("owner@demo.test", "Demo Café Group");
    const bistro = await scopeFor("bistro@demo.test", "Demo Bistro");
    const seen = await withTenant(database.db, bistro, (tx) => tx.select().from(businessDays));
    expect(new Set(seen.map((d) => d.orgId))).toEqual(new Set([bistro.orgId]));
    const dash = await getDashboard(database.db, cafe);
    expect(dash.recent.length).toBeGreaterThan(0);
    const r = await getPeriodReport(database.db, cafe, { from: shiftDate(todayIn(), -7), to: todayIn() });
    expect(r.daily.length).toBeGreaterThan(0);
  });
});
