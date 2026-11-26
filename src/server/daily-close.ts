// Reads for the Daily Close tab (v2.1): one branch, one business date. The
// figures themselves come from getDay in operations.ts, the same calculation
// the reports use; nothing here works money out on its own.
import { and, asc, desc, eq } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { businessDays, expenseCategories, expenses, type Currency, type PaidFrom } from "@/db/schema";
import type { getDay } from "./operations";

export type DayData = NonNullable<Awaited<ReturnType<typeof getDay>>>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The date Daily Close opens on: the one asked for, or else the oldest day
 * still open at the branch (it has to be closed first), or else today.
 */
export function pickCloseDate(requested: string | null | undefined, openDates: string[], today: string): string {
  if (isIsoDate(requested) && requested <= today) return requested;
  const oldest = [...openDates].sort()[0];
  return oldest ?? today;
}

/** The branch's business day on a date (id and status), and every day still open there. */
export function findCloseDay(db: DB, scope: TenantScope, locationId: string, date: string) {
  return withTenant(db, scope, async (tx) => {
    const [day] = await tx
      .select({ id: businessDays.id, status: businessDays.status })
      .from(businessDays)
      .where(and(eq(businessDays.locationId, locationId), eq(businessDays.businessDate, date)));
    const open = await tx
      .select({ id: businessDays.id, date: businessDays.businessDate })
      .from(businessDays)
      .where(and(eq(businessDays.locationId, locationId), eq(businessDays.status, "open")))
      .orderBy(asc(businessDays.businessDate));
    return { day: day ?? null, openDays: open };
  });
}

export type ExpenseTemplate = {
  key: string;
  categoryId: string;
  categoryName: string;
  description: string;
  vendor: string | null;
  currency: Currency;
  paidFrom: PaidFrom;
  /** The amount last time. Only ever a suggestion: the form shows it and a person saves. */
  amountMinor: bigint;
  lastDate: string;
};

/**
 * Recent expenses at a branch, one per kind (category, note, supplier,
 * currency and how it was paid), newest first. They only prefill the form;
 * nothing is ever saved from a template without someone pressing save.
 */
export function recentExpenseTemplates(db: DB, scope: TenantScope, locationId: string, limit = 6): Promise<ExpenseTemplate[]> {
  return withTenant(db, scope, async (tx) => {
    const rows = await tx
      .select({
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        archived: expenseCategories.archived,
        description: expenses.description,
        vendor: expenses.vendor,
        currency: expenses.currency,
        paidFrom: expenses.paidFrom,
        amountMinor: expenses.amountMinor,
        date: expenses.expenseDate,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(eq(expenses.locationId, locationId), eq(expenses.status, "active")))
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
      .limit(200);
    const seen = new Set<string>();
    const out: ExpenseTemplate[] = [];
    for (const r of rows) {
      if (r.archived || !r.description.trim()) continue;
      const key = [r.categoryId, r.description.trim().toLowerCase(), (r.vendor ?? "").trim().toLowerCase(), r.currency, r.paidFrom].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        description: r.description.trim(),
        vendor: r.vendor,
        currency: r.currency,
        paidFrom: r.paidFrom,
        amountMinor: r.amountMinor,
        lastDate: r.date,
      });
      if (out.length >= limit) break;
    }
    return out;
  });
}
