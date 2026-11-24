// Team management: members, invitations, locations and group settings.
// Owners only. Framework-free like operations.ts.
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { businessDays, invitations, locations, memberships, organizations, users, type Role } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";
import { hashToken, newToken } from "@/lib/tokens";
import { MoneyError, parseAmount } from "@/lib/money";
import { UserError } from "./operations";

/** Plan allowances from the business plan's pricing table. */
export const PLAN_LIMITS = {
  single: { label: "Single location", locations: 1, users: 5 },
  multi: { label: "Multi-branch", locations: 3, users: 15 },
  enterprise: { label: "Enterprise", locations: Infinity, users: Infinity },
} as const;

export { ROLES } from "@/lib/roles";

const INVITE_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireOwner(scope: TenantScope) {
  if (scope.role !== "owner") throw new UserError("Only owners can manage the team and locations.");
}

function cleanEmail(input: string) {
  const email = input.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new UserError("Enter a valid email address.");
  return email;
}

function cleanRole(input: string): Role {
  if (input !== "owner" && input !== "manager" && input !== "accountant") throw new UserError("Pick a role.");
  return input;
}

function cleanName(input: string, what: string, max = 60) {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) throw new UserError(`Enter a ${what}.`);
  if (name.length > max) throw new UserError(`Keep the ${what} under ${max} characters.`);
  return name;
}

const pendingInvite = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

// ---------------------------------------------------------------- read

export async function getTeam(db: DB, scope: TenantScope) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const members = await tx
      .select({
        membershipId: memberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(asc(users.name));
    const invites = await tx
      .select()
      .from(invitations)
      .where(pendingInvite)
      .orderBy(asc(invitations.createdAt));
    const locs = await tx
      .select({ id: locations.id, name: locations.name, createdAt: locations.createdAt, days: count(businessDays.id) })
      .from(locations)
      .leftJoin(businessDays, eq(businessDays.locationId, locations.id))
      .groupBy(locations.id)
      .orderBy(asc(locations.name));
    const limits = PLAN_LIMITS[org.plan];
    const now = Date.now();
    return {
      org: { id: org.id, name: org.name, plan: org.plan, toleranceCents: org.varianceToleranceCents },
      limits,
      usage: { locations: locs.length, users: members.length + invites.length },
      members: members.map((m) => ({ ...m, isYou: m.userId === scope.userId })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        expired: i.expiresAt.getTime() < now,
      })),
      locations: locs,
    };
  });
}

// ---------------------------------------------------------------- locations

export async function addLocation(db: DB, scope: TenantScope, rawName: string) {
  requireOwner(scope);
  const name = cleanName(rawName, "location name");
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const existing = await tx.select({ id: locations.id, name: locations.name }).from(locations);
    const limit = PLAN_LIMITS[org.plan].locations;
    if (existing.length >= limit) {
      throw new UserError(
        `The ${PLAN_LIMITS[org.plan].label} plan includes ${limit} location${limit === 1 ? "" : "s"}. Upgrade the plan to add more.`,
      );
    }
    if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      throw new UserError(`There's already a location called ${name}.`);
    }
    const [row] = await tx.insert(locations).values({ orgId: scope.orgId, name }).returning();
    return row;
  });
}

export async function renameLocation(db: DB, scope: TenantScope, locationId: string, rawName: string) {
  requireOwner(scope);
  const name = cleanName(rawName, "location name");
  return withTenant(db, scope, async (tx) => {
    const others = await tx.select({ id: locations.id, name: locations.name }).from(locations);
    if (!others.some((l) => l.id === locationId)) throw new UserError("That location doesn't exist.");
    if (others.some((l) => l.id !== locationId && l.name.toLowerCase() === name.toLowerCase())) {
      throw new UserError(`There's already a location called ${name}.`);
    }
    await tx.update(locations).set({ name }).where(eq(locations.id, locationId));
  });
}

// ---------------------------------------------------------------- invitations

export async function createInvite(db: DB, scope: TenantScope, input: { email: string; role: string }) {
  requireOwner(scope);
  const email = cleanEmail(input.email);
  const role = cleanRole(input.role);
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.email, email));
    if (member) throw new UserError(`${email} is already in the team.`);
    const [pending] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.email, email), pendingInvite));
    if (pending) throw new UserError(`${email} already has an invitation. Use "New link" to send it again.`);
    const [{ n: memberCount }] = await tx.select({ n: count() }).from(memberships);
    const [{ n: inviteCount }] = await tx.select({ n: count() }).from(invitations).where(pendingInvite);
    const limit = PLAN_LIMITS[org.plan].users;
    if (memberCount + inviteCount >= limit) {
      throw new UserError(`The ${PLAN_LIMITS[org.plan].label} plan includes ${limit} users. Remove someone or upgrade the plan.`);
    }
    const token = newToken();
    const [row] = await tx
      .insert(invitations)
      .values({
        orgId: scope.orgId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
        createdBy: scope.userId,
      })
      .returning({ id: invitations.id });
    return { id: row.id, token, email };
  });
}

/** Issues a fresh link for a pending invitation; the old link stops working. */
export async function renewInvite(db: DB, scope: TenantScope, inviteId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const token = newToken();
    const rows = await tx
      .update(invitations)
      .set({ tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
      .where(and(eq(invitations.id, inviteId), pendingInvite))
      .returning({ email: invitations.email });
    if (!rows.length) throw new UserError("That invitation is no longer pending.");
    return { token, email: rows[0].email };
  });
}

export async function revokeInvite(db: DB, scope: TenantScope, inviteId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const rows = await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(invitations.id, inviteId), pendingInvite))
      .returning({ id: invitations.id });
    if (!rows.length) throw new UserError("That invitation is no longer pending.");
  });
}

// ---------------------------------------------------------------- members

export async function changeRole(db: DB, scope: TenantScope, membershipId: string, rawRole: string) {
  requireOwner(scope);
  const role = cleanRole(rawRole);
  return withTenant(db, scope, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!m) throw new UserError("That person isn't in this team.");
    if (m.userId === scope.userId) throw new UserError("You can't change your own role. Ask another owner.");
    await tx.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
  });
}

export async function removeMember(db: DB, scope: TenantScope, membershipId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!m) throw new UserError("That person isn't in this team.");
    if (m.userId === scope.userId) throw new UserError("You can't remove yourself. Ask another owner.");
    await tx.delete(memberships).where(eq(memberships.id, membershipId));
  });
}

// ---------------------------------------------------------------- settings

export async function updateSettings(db: DB, scope: TenantScope, input: { name: string; tolerance: string }) {
  requireOwner(scope);
  const name = cleanName(input.name, "group name", 80);
  let toleranceCents: bigint;
  try {
    toleranceCents = parseAmount(input.tolerance, "USD");
  } catch (e) {
    if (e instanceof MoneyError) throw new UserError(`Cash tolerance: ${e.message}`);
    throw e;
  }
  if (toleranceCents > 10_000n) throw new UserError("Keep the cash tolerance at $100 or less.");
  return withTenant(db, scope, async (tx) => {
    await tx
      .update(organizations)
      .set({ name, varianceToleranceCents: toleranceCents })
      .where(eq(organizations.id, scope.orgId));
  });
}

// ---------------------------------------------------------------- accepting an invitation
// These run before the person belongs to the group, so they use the
// privileged connection and look the invitation up by its secret token.

export type InviteStatus = "valid" | "expired" | "used" | "revoked" | "missing";

export async function getInviteByToken(db: DB, token: string) {
  if (!token || token.length > 100) return { status: "missing" as InviteStatus };
  const [row] = await db
    .select({ invite: invitations, orgName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, hashToken(token)));
  if (!row) return { status: "missing" as InviteStatus };
  const i = row.invite;
  const status: InviteStatus = i.acceptedAt ? "used" : i.revokedAt ? "revoked" : i.expiresAt < new Date() ? "expired" : "valid";
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, i.email));
  return { status, email: i.email, role: i.role, orgName: row.orgName, existingUser: Boolean(existing) };
}

export async function acceptInvite(db: DB, token: string, input: { name?: string; password: string }) {
  return db.transaction(async (tx) => {
    const [i] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)))
      .for("update");
    if (!i) throw new UserError("This invitation link isn't valid.");
    if (i.acceptedAt) throw new UserError("This invitation has already been used.");
    if (i.revokedAt) throw new UserError("This invitation was cancelled. Ask the owner for a new one.");
    if (i.expiresAt < new Date()) throw new UserError("This invitation has expired. Ask the owner for a new link.");

    let [user] = await tx.select().from(users).where(eq(users.email, i.email));
    if (user) {
      if (!(await verifyPassword(input.password, user.passwordHash))) {
        throw new UserError(`That isn't the password for ${i.email}.`);
      }
    } else {
      const name = cleanName(input.name ?? "", "name", 80);
      if (input.password.length < 8) throw new UserError("Choose a password of at least 8 characters.");
      [user] = await tx
        .insert(users)
        .values({ email: i.email, name, passwordHash: await hashPassword(input.password) })
        .returning();
    }
    // Attribute the audit entries to the person joining.
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    await tx
      .insert(memberships)
      .values({ userId: user.id, orgId: i.orgId, role: i.role })
      .onConflictDoNothing({ target: [memberships.userId, memberships.orgId] });
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(invitations.id, i.id));
    return { userId: user.id, orgId: i.orgId };
  });
}
