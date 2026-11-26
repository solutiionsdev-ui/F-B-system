import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { memberships, users } from "@/db/schema";
import { createSession, defaultDemoUserId, isDemoMode, signOut } from "@/server/auth";
import { getDb } from "@/server/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Demo mode only: signs in without a password, as ?user=<id> or the first
 * owner, then returns to ?next= (a path on this site) or the dashboard.
 */
export async function GET(req: NextRequest) {
  if (!isDemoMode()) return new Response("Not found", { status: 404 });

  const sp = req.nextUrl.searchParams;
  const requested = sp.get("user");
  let userId: string | null = null;
  if (requested && UUID.test(requested)) {
    const db = await getDb();
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, requested));
    userId = u?.id ?? null;
  }
  userId ??= await defaultDemoUserId();
  if (!userId) return new Response("There are no users yet. Start with demo data (SEED_DEMO unset).", { status: 500 });

  // Stay in the business on screen when switching between its people.
  const org = sp.get("org");
  let orgId: string | undefined;
  if (org && UUID.test(org)) {
    const db = await getDb();
    const [m] = await db
      .select({ orgId: memberships.orgId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.orgId, org)));
    orgId = m?.orgId;
  }

  await signOut();
  await createSession(userId, orgId);
  const next = sp.get("next");
  redirect(next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
}
