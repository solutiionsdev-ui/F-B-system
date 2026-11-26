import { gte } from "drizzle-orm";
import { withTenant } from "@/db/database";
import { businessDays } from "@/db/schema";
import { omegaSampleCsv } from "@/lib/omega-sample";
import { getContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { todayIn } from "@/server/operations";
import { shiftDate } from "@/server/reports";

/**
 * Downloads sample-omega-export.csv: a fictional Omega "Daily Sales & Payment
 * Export" for the most recent date that has no business day yet, so it can be
 * previewed and imported straight away without colliding with a day that
 * already has sales.
 */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  const today = todayIn();
  const taken = new Set(
    (
      await withTenant(await getDb(), ctx.scope, (tx) =>
        tx.select({ date: businessDays.businessDate }).from(businessDays).where(gte(businessDays.businessDate, shiftDate(today, -60))),
      )
    ).map((d) => d.date),
  );
  let date = shiftDate(today, -1);
  for (let i = 0; i < 60 && taken.has(date); i++) date = shiftDate(date, -1);

  return new Response(omegaSampleCsv(date), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sample-omega-export.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
