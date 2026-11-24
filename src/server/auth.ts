import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gt } from "drizzle-orm";
import { memberships, organizations, sessions, users, type Role } from "@/db/schema";
import type { TenantScope } from "@/db/database";
import { verifyPassword } from "@/lib/password";
import { getDb } from "./db";

const COOKIE = "fnb_session";
const SESSION_DAYS = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: hashToken(token), userId: user.id, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return true;
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
  if (!ctx) redirect("/login");
  return ctx;
}

export async function setActiveOrg(ctx: AppContext, orgId: string) {
  if (!ctx.memberships.some((m) => m.orgId === orgId)) throw new Error("Not a member of that group");
  const db = await getDb();
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, ctx.sessionId));
}
