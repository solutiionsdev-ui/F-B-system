// Reads for the Expenses and Cash pages: what can be entered right now, and
// the list of cash movements in a period. Framework-free, like operations.ts,
// and open to every role (entering still needs owner or manager).
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { businessDays, cashMovements, exchangeRates, expenseCategories, locations, users, type Currency } from "@/db/schema";
import { movementKindOf, type MovementKind } from "@/lib/expense-buckets";
import { convert, parseRate } from "@/lib/money";
import { validateFilter, type ReportFilter } from "./reports";

export type OpenDayOption = { id: string; date: string; locationName: string };
export type CategoryOption = { id: string; name: string };

/** The open business days (expenses and movements are entered on one) and the categories offered. */
export function getEntryOptions(db: DB, scope: TenantScope) {
  return withTenant(db, scope, async (tx) => {
    const openDays: OpenDayOption[] = await tx
      .select({ id: businessDays.id, date: businessDays.businessDate, locationName: locations.name })
      .from(businessDays)
      .innerJoin(locations, eq(locations.id, businessDays.locationId))
      .where(eq(businessDays.status, "open"))
      .orderBy(desc(businessDays.businessDate), asc(locations.name));
    const categories: CategoryOption[] = await tx
      .select({ id: expenseCategories.id, name: expenseCategories.name })
      .from(expenseCategories)
      .where(eq(expenseCategories.archived, false))
      .orderBy(asc(expenseCategories.position), asc(expenseCategories.name));
    return { openDays, categories };
  });
}

export type MovementRow = {
  id: string;
  dayId: string;
  date: string;
  dayOpen: boolean;
  locationName: string;
  kind: MovementKind;
  direction: "in" | "out";
  currency: Currency;
  amountMinor: bigint;
  /** USD equivalent at the rate of the day it belongs to. */
  eq: bigint;
  reason: string;
  enteredBy: string | null;
};

/** Safe drops, partner withdrawals and cash put in, newest first. */
export async function listMovements(db: DB, scope: TenantScope, filter: ReportFilter): Promise<MovementRow[]> {
  const f = validateFilter(filter);
  return withTenant(db, scope, async (tx) => {
    const rows = await tx
      .select({
        m: cashMovements,
        date: businessDays.businessDate,
        status: businessDays.status,
        locationName: locations.name,
        rate: exchangeRates.lbpPerUsd,
        enteredBy: users.name,
      })
      .from(cashMovements)
      .innerJoin(businessDays, eq(businessDays.id, cashMovements.businessDayId))
      .innerJoin(locations, eq(locations.id, businessDays.locationId))
      .innerJoin(exchangeRates, eq(exchangeRates.id, businessDays.rateId))
      .leftJoin(users, eq(users.id, cashMovements.createdBy))
      .where(
        and(
          gte(businessDays.businessDate, f.from),
          lte(businessDays.businessDate, f.to),
          f.locationId ? eq(businessDays.locationId, f.locationId) : undefined,
        ),
      )
      .orderBy(desc(businessDays.businessDate), desc(cashMovements.createdAt));
    return rows.map((r) => ({
      id: r.m.id,
      dayId: r.m.businessDayId,
      date: r.date,
      dayOpen: r.status === "open",
      locationName: r.locationName,
      kind: movementKindOf(r.m),
      direction: r.m.direction,
      currency: r.m.currency,
      amountMinor: r.m.amountMinor,
      eq: convert(r.m.amountMinor, r.m.currency, "USD", parseRate(r.rate)),
      reason: r.m.reason,
      enteredBy: r.enteredBy,
    }));
  });
}
