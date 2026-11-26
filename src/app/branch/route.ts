import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BRANCH_COOKIE, getContext } from "@/server/auth";

/**
 * The sidebar's branch switcher: ?location=<id> (empty for all branches) and
 * ?next=<path on this site>. Only a venue the person may see is remembered.
 */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  const sp = req.nextUrl.searchParams;
  const next = sp.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  if (!ctx) redirect("/");
  const wanted = sp.get("location") ?? "";
  const jar = await cookies();
  if (wanted && ctx.branches.some((b) => b.id === wanted)) {
    jar.set(BRANCH_COOKIE, wanted, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86_400 });
  } else {
    jar.delete(BRANCH_COOKIE);
  }
  redirect(safeNext);
}
