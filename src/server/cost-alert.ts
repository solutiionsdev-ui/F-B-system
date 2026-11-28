// The cost alert on Performance: the last 30 full days against the 30 days
// before, branch by branch, from the same report figures the page shows.
import type { DB, TenantScope } from "@/db/database";
import { costAlert, type PeriodTotals } from "@/lib/cost-alert";
import { getPeriodReport, previousPeriod, shiftDate, type PeriodReport, type ReportFilter } from "./reports";

export const ALERT_WINDOW_DAYS = 30;

/** Sales, costs and costs by category for each branch in a report. */
export function branchTotals(r: PeriodReport): PeriodTotals[] {
  const byId = new Map<string, PeriodTotals>();
  const of = (id: string, name: string) => {
    let t = byId.get(id);
    if (!t) byId.set(id, (t = { locationId: id, name, salesEq: 0n, costsEq: 0n, salesDays: 0, categories: {} }));
    return t;
  };
  for (const d of r.daily) {
    const t = of(d.locationId, d.locationName);
    t.salesEq += d.salesEq.collected;
    if (d.hasSales) t.salesDays++;
  }
  for (const e of r.expenses) {
    if (e.status !== "active") continue;
    const t = of(e.locationId, e.locationName);
    t.costsEq += e.eq;
    t.categories[e.category] = (t.categories[e.category] ?? 0n) + e.eq;
  }
  return [...byId.values()];
}

/** The alert for a branch (or all branches), as of the day before `today`. Needs view_reports. */
export async function getCostAlert(db: DB, scope: TenantScope, input: { today: string; locationId: string | null }) {
  const end = shiftDate(input.today, -1);
  const window: ReportFilter = { from: shiftDate(end, -(ALERT_WINDOW_DAYS - 1)), to: end, locationId: input.locationId };
  const previous = previousPeriod(window);
  // One after the other: both run in their own tenant transaction.
  const now = await getPeriodReport(db, scope, window);
  const before = await getPeriodReport(db, scope, previous);
  return { window, previous, ...costAlert(branchTotals(now), branchTotals(before), now.org.costAlertBp) };
}
