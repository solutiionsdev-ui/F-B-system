import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { migrate, openPglite, withTenant, type Database, type TenantScope } from "@/db/database";
import { DEMO_PASSWORD, seedDemo } from "@/db/seed";
import { invitations, locations, memberships, organizations, users } from "@/db/schema";
import { hashToken } from "@/lib/tokens";
import { UserError } from "@/server/operations";
import {
  acceptInvite,
  addLocation,
  changeRole,
  createInvite,
  getInviteByToken,
  getTeam,
  removeMember,
  renameLocation,
  renewInvite,
  revokeInvite,
  updateSettings,
} from "@/server/team";

let database: Database;
let cafeOwner: TenantScope;
let cafeManager: TenantScope;
let bistroOwner: TenantScope;
let cafeVenue: string;
let bistroVenue: string;

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
  const scopeFor = async (email: string, orgName: string): Promise<TenantScope> => {
    const [row] = await database.db
      .select({ userId: users.id, orgId: organizations.id, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(users.email, email), eq(organizations.name, orgName)));
    return row;
  };
  cafeOwner = await scopeFor("owner@demo.test", "Demo Café Group");
  cafeManager = await scopeFor("manager@demo.test", "Demo Café Group");
  bistroOwner = await scopeFor("bistro@demo.test", "Demo Bistro");
  [cafeVenue] = (await database.db.select().from(locations).where(eq(locations.orgId, cafeOwner.orgId))).map((l) => l.id);
  [bistroVenue] = (await database.db.select().from(locations).where(eq(locations.orgId, bistroOwner.orgId))).map((l) => l.id);
});

afterAll(async () => {
  await database?.close();
});

describe("team overview", () => {
  it("is for owners only", async () => {
    await expect(getTeam(database.db, cafeManager)).rejects.toThrow(UserError);
    const team = await getTeam(database.db, cafeOwner);
    expect(team.members.map((m) => m.role).sort()).toEqual(["accountant", "manager", "owner"]);
    expect(team.members.find((m) => m.isYou)?.role).toBe("owner");
    expect(team.usage).toEqual({ locations: 2, users: 3 });
    expect(team.limits.locations).toBe(3);
  });

  it("only shows the owner's own group", async () => {
    const team = await getTeam(database.db, bistroOwner);
    expect(team.locations.map((l) => l.name)).toEqual(["Mar Mikhael"]);
    expect(team.members.map((m) => m.email).sort()).toEqual(["accountant@demo.test", "bistro@demo.test"]);
  });
});

describe("locations", () => {
  it("respects the plan's location allowance", async () => {
    await expect(addLocation(database.db, bistroOwner, "Second branch")).rejects.toThrow(/Single location plan includes 1/);
    await addLocation(database.db, cafeOwner, "Badaro");
    await expect(addLocation(database.db, cafeOwner, "Jounieh")).rejects.toThrow(/3 locations/);
  });

  it("refuses duplicate names and renames cleanly", async () => {
    const team = await getTeam(database.db, cafeOwner);
    const badaro = team.locations.find((l) => l.name === "Badaro")!;
    await expect(renameLocation(database.db, cafeOwner, badaro.id, "hamra")).rejects.toThrow(/already a location/);
    await renameLocation(database.db, cafeOwner, badaro.id, "  Badaro   Street ");
    const after = await getTeam(database.db, cafeOwner);
    expect(after.locations.map((l) => l.name)).toContain("Badaro Street");
  });

  it("can't be renamed across groups", async () => {
    const team = await getTeam(database.db, cafeOwner);
    await expect(renameLocation(database.db, bistroOwner, team.locations[0].id, "Hijacked")).rejects.toThrow(UserError);
  });
});

describe("invitations", () => {
  it("lets a new person join with their own password", async () => {
    const inv = await createInvite(database.db, cafeOwner, { email: "  Lara@Example.com ", role: "manager", locationIds: [cafeVenue] });
    expect(inv.email).toBe("lara@example.com");
    const [stored] = await database.db.select().from(invitations).where(eq(invitations.id, inv.id));
    expect(stored.tokenHash).toBe(hashToken(inv.token));
    expect(stored.tokenHash).not.toContain(inv.token);

    const info = await getInviteByToken(database.db, inv.token);
    expect(info).toMatchObject({ status: "valid", orgName: "Demo Café Group", role: "manager", existingUser: false });

    await expect(acceptInvite(database.db, inv.token, { name: "Lara", password: "short" })).rejects.toThrow(/8 characters/);
    const joined = await acceptInvite(database.db, inv.token, { name: "Lara", password: "long-enough-pw" });
    expect(joined.orgId).toBe(cafeOwner.orgId);
    const team = await getTeam(database.db, cafeOwner);
    expect(team.members.find((m) => m.email === "lara@example.com")?.role).toBe("manager");

    expect((await getInviteByToken(database.db, inv.token)).status).toBe("used");
    await expect(acceptInvite(database.db, inv.token, { name: "Lara", password: "long-enough-pw" })).rejects.toThrow(/already been used/);
  });

  it("asks an existing account for its password", async () => {
    const inv = await createInvite(database.db, bistroOwner, { email: "manager@demo.test", role: "manager", locationIds: [bistroVenue] });
    expect((await getInviteByToken(database.db, inv.token)).existingUser).toBe(true);
    await expect(acceptInvite(database.db, inv.token, { password: "wrong-password" })).rejects.toThrow(/isn't the password/);
    await acceptInvite(database.db, inv.token, { password: DEMO_PASSWORD });
    const team = await getTeam(database.db, bistroOwner);
    expect(team.members.some((m) => m.email === "manager@demo.test")).toBe(true);
  });

  it("refuses duplicates and people already in the team", async () => {
    await expect(createInvite(database.db, cafeOwner, { email: "manager@demo.test", role: "manager", locationIds: [cafeVenue] })).rejects.toThrow(
      /already in the team/,
    );
    await createInvite(database.db, cafeOwner, { email: "sami@example.com", role: "accountant", locationIds: [cafeVenue] });
    await expect(createInvite(database.db, cafeOwner, { email: "sami@example.com", role: "manager", locationIds: [cafeVenue] })).rejects.toThrow(
      /already has an invitation/,
    );
    await expect(createInvite(database.db, cafeOwner, { email: "not-an-email", role: "manager", locationIds: [cafeVenue] })).rejects.toThrow(UserError);
  });

  it("can be renewed (old link dies) or revoked", async () => {
    const inv = await createInvite(database.db, cafeOwner, { email: "rami@example.com", role: "manager", locationIds: [cafeVenue] });
    const renewed = await renewInvite(database.db, cafeOwner, inv.id);
    expect((await getInviteByToken(database.db, inv.token)).status).toBe("missing");
    expect((await getInviteByToken(database.db, renewed.token)).status).toBe("valid");
    await revokeInvite(database.db, cafeOwner, inv.id);
    expect((await getInviteByToken(database.db, renewed.token)).status).toBe("revoked");
    await expect(acceptInvite(database.db, renewed.token, { name: "Rami", password: "long-enough-pw" })).rejects.toThrow(/cancelled/);
  });

  it("expire after their deadline", async () => {
    const inv = await createInvite(database.db, cafeOwner, { email: "old@example.com", role: "manager", locationIds: [cafeVenue] });
    await database.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, inv.id));
    expect((await getInviteByToken(database.db, inv.token)).status).toBe("expired");
    await expect(acceptInvite(database.db, inv.token, { name: "Old", password: "long-enough-pw" })).rejects.toThrow(/expired/);
    await revokeInvite(database.db, cafeOwner, inv.id);
  });

  it("count against the plan's user allowance", async () => {
    // Bistro is on the Single plan (5 users): owner, accountant, manager + 2 invites fill it.
    await createInvite(database.db, bistroOwner, { email: "a@example.com", role: "manager", locationIds: [bistroVenue] });
    await createInvite(database.db, bistroOwner, { email: "b@example.com", role: "manager", locationIds: [bistroVenue] });
    await expect(createInvite(database.db, bistroOwner, { email: "c@example.com", role: "manager", locationIds: [bistroVenue] })).rejects.toThrow(
      /includes 5 users/,
    );
  });

  it("can't be created by managers, even bypassing the app", async () => {
    await expect(createInvite(database.db, cafeManager, { email: "x@example.com", role: "owner" })).rejects.toThrow(UserError);
    await expectPgError(
      withTenant(database.db, cafeManager, (tx) =>
        tx.insert(invitations).values({
          orgId: cafeManager.orgId,
          email: "x@example.com",
          role: "owner",
          tokenHash: "x",
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
      "42501",
    );
  });
});

describe("members", () => {
  it("lets an owner change roles and remove people, but not themselves", async () => {
    const team = await getTeam(database.db, cafeOwner);
    const lara = team.members.find((m) => m.email === "lara@example.com")!;
    await changeRole(database.db, cafeOwner, lara.membershipId, "accountant");
    const me = team.members.find((m) => m.isYou)!;
    await expect(changeRole(database.db, cafeOwner, me.membershipId, "manager")).rejects.toThrow(/your own role/);
    await expect(removeMember(database.db, cafeOwner, me.membershipId)).rejects.toThrow(/remove yourself/);
    await removeMember(database.db, cafeOwner, lara.membershipId);
    const after = await getTeam(database.db, cafeOwner);
    expect(after.members.some((m) => m.email === "lara@example.com")).toBe(false);
  });

  it("always keeps at least one owner, at the database level", async () => {
    const [ownerMembership] = await database.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, cafeOwner.orgId), eq(memberships.role, "owner")));
    await expectPgError(
      database.db.update(memberships).set({ role: "manager" }).where(eq(memberships.id, ownerMembership.id)),
      "P0001",
    );
    await expectPgError(database.db.delete(memberships).where(eq(memberships.id, ownerMembership.id)), "P0001");
  });

  it("can't be changed from another group", async () => {
    const team = await getTeam(database.db, cafeOwner);
    const manager = team.members.find((m) => m.role === "manager")!;
    await expect(changeRole(database.db, bistroOwner, manager.membershipId, "owner")).rejects.toThrow(/isn't in this team/);
    await expect(removeMember(database.db, bistroOwner, manager.membershipId)).rejects.toThrow(/isn't in this team/);
  });
});

describe("settings", () => {
  it("updates the group name and the per-currency rounding allowances", async () => {
    await updateSettings(database.db, cafeOwner, { name: "Café Group Lebanon", toleranceUsd: "2.50", toleranceLbp: "50k" });
    const team = await getTeam(database.db, cafeOwner);
    expect(team.org.name).toBe("Café Group Lebanon");
    expect(team.org.tolerance).toEqual({ USD: 250n, LBP: 50_000n });
    await expect(updateSettings(database.db, cafeOwner, { name: "X", toleranceUsd: "500", toleranceLbp: "0" })).rejects.toThrow(/\$100/);
    await expect(updateSettings(database.db, cafeOwner, { name: "X", toleranceUsd: "0", toleranceLbp: "20m" })).rejects.toThrow(/LBP/);
    await expect(updateSettings(database.db, cafeManager, { name: "X", toleranceUsd: "1", toleranceLbp: "0" })).rejects.toThrow(UserError);
  });
});
