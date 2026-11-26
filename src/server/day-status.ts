// The one business-day status query. Today, Cash Close, Reports and the
// exports all count days through here, so identical filters give identical
// counts (spec 15 and acceptance test G).
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { type DB, type TenantScope, type Tx, withTenant } from "@/db/database";
import { businessDays, dayClosings } from "@/db/schema";
import { dayStatusOf, summarizeStatuses, type DayStatus, type StatusSummary } from "@/lib/day-status";

export type StatusFilter = { from?: string | null; to?: string | null; locationId?: string | null };
export type DayStatusRow = { dayId: string; date: string; locationId: string; status: DayStatus };

/** Every business day in the filter with its status, oldest first. No limit. */
export async function queryDayStatuses(tx: Tx, f: StatusFilter): Promise<DayStatusRow[]> {
  const rows = await tx
    .select({
      dayId: businessDays.id,
      date: businessDays.businessDate,
      locationId: businessDays.locationId,
      status: businessDays.status,
      withinTolerance: dayClosings.withinTolerance,
    })
    .from(businessDays)
    .leftJoin(dayClosings, eq(dayClosings.businessDayId, businessDays.id))
    .where(
      and(
        f.from ? gte(businessDays.businessDate, f.from) : undefined,
        f.to ? lte(businessDays.businessDate, f.to) : undefined,
        f.locationId ? eq(businessDays.locationId, f.locationId) : undefined,
      ),
    )
    .orderBy(asc(businessDays.businessDate), asc(businessDays.locationId));
  return rows.map((r) => ({
    dayId: r.dayId,
    date: r.date,
    locationId: r.locationId,
    status: dayStatusOf(r, r.withinTolerance == null ? null : { withinTolerance: r.withinTolerance }),
  }));
}

export async function statusSummaryIn(tx: Tx, f: StatusFilter): Promise<StatusSummary> {
  return summarizeStatuses((await queryDayStatuses(tx, f)).map((r) => r.status));
}

/** Records, closed, balanced, flagged and open days for a period and venue. */
export function getStatusSummary(db: DB, scope: TenantScope, f: StatusFilter): Promise<StatusSummary> {
  return withTenant(db, scope, (tx) => statusSummaryIn(tx, f));
}
