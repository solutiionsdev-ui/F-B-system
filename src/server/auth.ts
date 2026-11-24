import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gt } from "drizzle-orm";
import { memberships, organizations, sessions, users, type Role } from "@/db/schema";
import type { TenantScope } from "@/db/database";
import { verifyPassword } from "@/lib/password";
import { hashToken, newToken } from "@/lib/tokens";
import { getDb } from "./db";

const COOKIE = "fnb_session";
const SESSION_DAYS = 7;

/**
 * Demo mode skips the login screen: everyone is signed in automatically and
 * can switch between users from the header. On by default in development;
 * in production it's off unless DEMO_MODE=true is set deliberately.
 * Set DEMO_MODE=false to bring the login screen back.
 */
export function isDemoMode() {
  if (process.env.DEMO_MODE === "true") return true;
  if (process.env.DEMO_MODE === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export type Membership = { orgId: string; orgName: string; role: Role };
export type AppContext = {
  sessionId: string;
  user: { id: string; name: string; email: string };
  memberships: Membership[];
  active: Membership;
  scope: TenantScope;
};

export async function signIn(email: string, password: string): Promise<boolean> {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  // Hash anyway when the user doesn't exist, so timing doesn't reveal which emails are registered.
  const ok = await verifyPassword(
    password,
    user?.passwordHash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  if (!user || !ok) return false;
  await createSession(user.id);
  return true;
}

/** Starts a session for a user and sets the cookie (Server Actions and Route Handlers only). */
export async function createSession(userId: string, activeOrgId?: string) {
  const db = await getDb();
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, activeOrgId: activeOrgId ?? null, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Everyone who can be picked in demo mode's "Viewing as" switcher. */
export async function listDemoUsers() {
  if (!isDemoMode()) return [];
  const db = await getDb();
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name));
}

/** The user demo mode signs in as by default: the first owner. */
export async function defaultDemoUserId(): Promise<string | null> {
  const db = await getDb();
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(memberships.role, "owner"))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return owner?.id ?? null;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  jar.delete(COOKIE);
}

/** The signed-in person and the restaurant group they're working in, or null. */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ session: sessions, user: { id: users.id, name: users.name, email: users.email } })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const ms = await db
    .select({ orgId: memberships.orgId, orgName: organizations.name, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, row.user.id))
    .orderBy(asc(organizations.name));
  if (ms.length === 0) return null;
  const active = ms.find((m) => m.orgId === row.session.activeOrgId) ?? ms[0];
  return {
    sessionId: row.session.id,
    user: row.user,
    memberships: ms,
    active,
    scope: { orgId: active.orgId, userId: row.user.id, role: active.role },
  };
});

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect(isDemoMode() ? "/auth/demo" : "/login");
  return ctx;
}

export async function setActiveOrg(ctx: AppContext, orgId: string) {
  if (!ctx.memberships.some((m) => m.orgId === orgId)) throw new Error("Not a member of that group");
  const db = await getDb();
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, ctx.sessionId));
}
