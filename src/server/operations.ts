// Business operations. Framework-free (no Next.js imports) so the same code
// runs in the app, in the seed script and in tests. Every function that
// touches restaurant data goes through withTenant(), so row-level security
// applies to it.
import { and, asc, count, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { type DB, type TenantScope, type Tx, withTenant } from "@/db/database";
import {
  adjustments,
  auditLog,
  businessDays,
  cashCounts,
  cashMovements,
  dayClosings,
  exchangeRates,
  expenseCategories,
  expenses,
  invitations,
  locations,
  organizations,
  posImports,
  salesLines,
  users,
  type Currency,
  type PaidFrom,
  type Role,
  type SalesLineType,
  type Tender,
  type VarianceReason,
} from "@/db/schema";
import { computeExpected, reconcile, salesSummary } from "@/lib/closing";
import { dayStatusOf } from "@/lib/day-status";
import { pickRateForDate } from "@/lib/rates";
import { isMovementKind, movementDirection, type MovementKind } from "@/lib/expense-buckets";
import { CURRENCIES, countTotal, parseRate, rateToDb, RATE_SCALE, type Pair } from "@/lib/money";

/** An error whose message is safe and useful to show to the person. */
export class UserError extends Error {}

export const BEIRUT_TZ = "Asia/Beirut";

export function todayIn(timeZone = BEIRUT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function requireRole(scope: TenantScope, allowed: Role[], action: string) {
  if (!allowed.includes(scope.role)) {
    throw new UserError(`Your role (${scope.role}) can't ${action}.`);
  }
}

const OPS: Role[] = ["owner", "manager"];

async function loadOpenDay(tx: Tx, dayId: string) {
  const [day] = await tx.select().from(businessDays).where(eq(businessDays.id, dayId)).for("update");
  if (!day) throw new UserError("That business day doesn't exist.");
  if (day.status === "closed") throw new UserError("This day is closed. Record a correction as an adjustment instead.");
  return day;
}

// ---------------------------------------------------------------- rates

export async function currentRate(tx: Tx, at: Date = new Date()) {
  const [rate] = await tx
    .select()
    .from(exchangeRates)
    .where(lte(exchangeRates.effectiveAt, at))
    .orderBy(desc(exchangeRates.effectiveAt), desc(exchangeRates.createdAt))
    .limit(1);
  return rate ?? null;
}

/**
 * The rate a business day on `date` snapshots when it's opened: the one in
 * force at the end of that date in the venue's time zone (see lib/rates.ts).
 */
export async function rateForBusinessDate(tx: Tx, date: string, timeZone: string, now = new Date()) {
  const rates = await tx.select().from(exchangeRates);
  return pickRateForDate(rates, date, timeZone, now);
}

export async function setRate(
  db: DB,
  scope: TenantScope,
  input: { lbpPerUsd: string; source: "market" | "bank" | "custom"; note?: string },
) {
  requireRole(scope, OPS, "change the exchange rate");
  const rate = parseRate(input.lbpPerUsd);
  if (rate < 1_000n * RATE_SCALE || rate > 1_000_000n * RATE_SCALE) {
    throw new UserError("That rate looks wrong. Enter LBP per 1 USD, for example 89,500.");
  }
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx
      .insert(exchangeRates)
      .values({
        orgId: scope.orgId,
        lbpPerUsd: rateToDb(rate),
        source: input.source,
        note: input.note?.trim() || null,
        createdBy: scope.userId,
      })
      .returning();
    return row;
  });
}

export function listRates(db: DB, scope: TenantScope) {
  return withTenant(db, scope, (tx) =>
    tx
      .select({
        id: exchangeRates.id,
        lbpPerUsd: exchangeRates.lbpPerUsd,
        source: exchangeRates.source,
        note: exchangeRates.note,
        effectiveAt: exchangeRates.effectiveAt,
        createdByName: users.name,
      })
      .from(exchangeRates)
      .leftJoin(users, eq(users.id, exchangeRates.createdBy))
      .orderBy(desc(exchangeRates.effectiveAt))
      .limit(100),
  );
}

// ---------------------------------------------------------------- days

export async function openDay(
  db: DB,
  scope: TenantScope,
  input: { locationId: string; businessDate: string; openingFloat: Pair },
) {
  requireRole(scope, OPS, "open a business day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) throw new UserError("Pick a valid business date.");
  return withTenant(db, scope, async (tx) => {
    const [location] = await tx.select().from(locations).where(eq(locations.id, input.locationId));
    if (!location) throw new UserError("Pick a location.");
    const choice = await rateForBusinessDate(tx, input.businessDate, location.timezone);
    if (!choice) throw new UserError("Set today's exchange rate before opening a day.");
    const rate = choice.rate;
    const [existing] = await tx
      .select({ id: businessDays.id })
      .from(businessDays)
      .where(and(eq(businessDays.locationId, location.id), eq(businessDays.businessDate, input.businessDate)));
    if (existing) throw new UserError(`${location.name} already has a day for ${input.businessDate}.`);
    const [day] = await tx
      .insert(businessDays)
      .values({
        orgId: scope.orgId,
        locationId: location.id,
        businessDate: input.businessDate,
        rateId: rate.id,
        openingFloatUsd: input.openingFloat.USD,
        openingFloatLbp: input.openingFloat.LBP,
        openedBy: scope.userId,
      })
      .returning();
    return { ...day, rateLbpPerUsd: rate.lbpPerUsd, rateFallback: choice.fallback };
  });
}

/** Corrects the cash the drawer started with (e.g. a day opened by a POS import). */
export async function setOpeningFloat(db: DB, scope: TenantScope, dayId: string, float: Pair) {
  requireRole(scope, OPS, "change the opening float");
  if (float.USD < 0n || float.LBP < 0n) throw new UserError("The opening float can't be negative.");
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, dayId);
    await tx
      .update(businessDays)
      .set({ openingFloatUsd: float.USD, openingFloatLbp: float.LBP })
      .where(eq(businessDays.id, day.id));
  });
}

export type SalesTotalsInput = {
  cash: Pair;
  card: Pair;
  other: Pair;
  cashRefunds: Pair;
  discounts: Pair;
  voids: Pair;
  tax: Pair;
  serviceCharge: Pair;
};

/** Replaces the hand-entered POS end-of-day totals for a day. */
export async function saveManualSales(db: DB, scope: TenantScope, dayId: string, totals: SalesTotalsInput) {
  requireRole(scope, OPS, "enter sales");
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, dayId);
    const [imported] = await tx
      .select({ id: salesLines.id })
      .from(salesLines)
      .where(and(eq(salesLines.businessDayId, day.id), eq(salesLines.source, "pos_import")))
      .limit(1);
    if (imported) {
      throw new UserError("This day's sales were imported from the POS. Undo that import to type totals by hand instead.");
    }
    await tx.delete(salesLines).where(and(eq(salesLines.businessDayId, day.id), eq(salesLines.source, "manual")));
    const rows: (typeof salesLines.$inferInsert)[] = [];
    const add = (lineType: SalesLineType, tender: Tender | null, pair: Pair) => {
      for (const c of CURRENCIES) {
        if (pair[c] < 0n) throw new UserError("Amounts can't be negative.");
        if (pair[c] === 0n) continue;
        rows.push({
          orgId: scope.orgId,
          locationId: day.locationId,
          businessDayId: day.id,
          source: "manual",
          lineType,
          tender,
          currency: c,
          amountMinor: pair[c],
          createdBy: scope.userId,
        });
      }
    };
    add("payment", "cash", totals.cash);
    add("payment", "card", totals.card);
    add("payment", "other", totals.other);
    add("refund", "cash", totals.cashRefunds);
    add("discount", null, totals.discounts);
    add("void", null, totals.voids);
    add("tax", null, totals.tax);
    add("service_charge", null, totals.serviceCharge);
    if (rows.length) await tx.insert(salesLines).values(rows);
    return rows.length;
  });
}

// ---------------------------------------------------------------- expenses & movements

export async function addExpense(
  db: DB,
  scope: TenantScope,
  input: {
    dayId: string;
    categoryId: string;
    /** Notes; optional. */
    description?: string;
    vendor?: string;
    receiptRef?: string;
    currency: Currency;
    amountMinor: bigint;
    paidFrom: PaidFrom;
  },
) {
  requireRole(scope, OPS, "record expenses");
  if (input.amountMinor <= 0n) throw new UserError("Enter an amount greater than zero.");
  if (!input.categoryId) throw new UserError("Pick a category for the expense.");
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, input.dayId);
    const [cat] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId));
    if (!cat || cat.archived) throw new UserError("Pick one of the categories in the list.");
    const [row] = await tx
      .insert(expenses)
      .values({
        orgId: scope.orgId,
        locationId: day.locationId,
        businessDayId: day.id,
        expenseDate: day.businessDate,
        categoryId: input.categoryId,
        description: input.description?.trim() ?? "",
        vendor: input.vendor?.trim() || null,
        receiptRef: input.receiptRef?.trim() || null,
        currency: input.currency,
        amountMinor: input.amountMinor,
        paidFrom: input.paidFrom,
        rateId: day.rateId,
        createdBy: scope.userId,
      })
      .returning();
    return row;
  });
}

export async function voidExpense(db: DB, scope: TenantScope, expenseId: string, reason: string) {
  requireRole(scope, OPS, "void expenses");
  if (!reason.trim()) throw new UserError("Say why the expense is being voided.");
  return withTenant(db, scope, async (tx) => {
    const [exp] = await tx.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!exp) throw new UserError("That expense doesn't exist.");
    if (exp.status === "voided") throw new UserError("That expense is already voided.");
    await tx
      .update(expenses)
      .set({ status: "voided", voidReason: reason.trim(), voidedBy: scope.userId, voidedAt: new Date() })
      .where(eq(expenses.id, expenseId));
  });
}

export async function addMovement(
  db: DB,
  scope: TenantScope,
  input: { dayId: string; kind: MovementKind; currency: Currency; amountMinor: bigint; reason?: string },
) {
  requireRole(scope, OPS, "record cash movements");
  if (!isMovementKind(input.kind)) throw new UserError("Pick what kind of cash movement this is.");
  if (input.amountMinor <= 0n) throw new UserError("Enter an amount greater than zero.");
  const reason = input.reason?.trim() ?? "";
  if (input.kind === "other" && !reason) throw new UserError("Say what the cash was taken out for.");
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, input.dayId);
    await tx.insert(cashMovements).values({
      orgId: scope.orgId,
      businessDayId: day.id,
      kind: input.kind,
      direction: movementDirection(input.kind),
      currency: input.currency,
      amountMinor: input.amountMinor,
      reason,
      createdBy: scope.userId,
    });
  });
}

export async function deleteMovement(db: DB, scope: TenantScope, movementId: string) {
  requireRole(scope, OPS, "remove cash movements");
  return withTenant(db, scope, async (tx) => {
    await tx.delete(cashMovements).where(eq(cashMovements.id, movementId));
  });
}

// ---------------------------------------------------------------- counting & closing

export async function saveCount(
  db: DB,
  scope: TenantScope,
  input: { dayId: string; currency: Currency; denominations: Record<string, number>; looseMinor: bigint },
) {
  requireRole(scope, OPS, "count the drawer");
  const counts = Object.fromEntries(Object.entries(input.denominations).filter(([, q]) => q > 0));
  const total = countTotal(counts, input.currency, input.looseMinor);
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, input.dayId);
    await tx
      .insert(cashCounts)
      .values({
        orgId: scope.orgId,
        businessDayId: day.id,
        currency: input.currency,
        denominations: counts,
        looseMinor: input.looseMinor,
        countedMinor: total,
        countedBy: scope.userId,
      })
      .onConflictDoUpdate({
        target: [cashCounts.businessDayId, cashCounts.currency],
        set: {
          denominations: counts,
          looseMinor: input.looseMinor,
          countedMinor: total,
          countedBy: scope.userId,
          countedAt: new Date(),
        },
      });
    return total;
  });
}

async function computeDay(tx: Tx, day: typeof businessDays.$inferSelect) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, day.orgId));
  const [rate] = await tx.select().from(exchangeRates).where(eq(exchangeRates.id, day.rateId));
  const lines = await tx.select().from(salesLines).where(eq(salesLines.businessDayId, day.id));
  const exps = await tx
    .select({
      id: expenses.id,
      description: expenses.description,
      vendor: expenses.vendor,
      receiptRef: expenses.receiptRef,
      currency: expenses.currency,
      amountMinor: expenses.amountMinor,
      paidFrom: expenses.paidFrom,
      status: expenses.status,
      voidReason: expenses.voidReason,
      createdAt: expenses.createdAt,
      categoryName: expenseCategories.name,
      createdByName: users.name,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .where(eq(expenses.businessDayId, day.id))
    .orderBy(asc(expenses.createdAt));
  const movements = await tx
    .select()
    .from(cashMovements)
    .where(eq(cashMovements.businessDayId, day.id))
    .orderBy(asc(cashMovements.createdAt));
  const counts = await tx.select().from(cashCounts).where(eq(cashCounts.businessDayId, day.id));

  const rateScaled = parseRate(rate.lbpPerUsd);
  const breakdown = computeExpected({
    openingFloat: { USD: day.openingFloatUsd, LBP: day.openingFloatLbp },
    sales: lines,
    expenses: exps,
    movements,
  });
  const countByCurrency = Object.fromEntries(counts.map((c) => [c.currency, c])) as Partial<
    Record<Currency, (typeof counts)[number]>
  >;
  const counted: Pair = { USD: countByCurrency.USD?.countedMinor ?? 0n, LBP: countByCurrency.LBP?.countedMinor ?? 0n };
  const tolerance: Pair = { USD: org.toleranceUsdCents, LBP: org.toleranceLbp };
  const recon = reconcile(breakdown.expected, counted, rateScaled, tolerance);
  return {
    org,
    rate,
    rateScaled,
    lines,
    expenses: exps,
    movements,
    counts: countByCurrency,
    countsComplete: Boolean(countByCurrency.USD && countByCurrency.LBP),
    /** At least one payment (any tender) is recorded for the day. */
    hasSales: lines.some((l) => l.lineType === "payment"),
    tolerance,
    breakdown,
    recon,
    sales: salesSummary(lines),
  };
}

export async function closeDay(
  db: DB,
  scope: TenantScope,
  dayId: string,
  input: { reason?: VarianceReason | null; note?: string; noSalesReason?: string },
) {
  requireRole(scope, OPS, "close a business day");
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, dayId);
    const d = await computeDay(tx, day);
    if (!d.countsComplete) throw new UserError("Count both the USD and LBP cash before closing.");
    const note = input.note?.trim() ?? "";
    // Spec 12.5: any difference, in either currency and however small, needs a written explanation.
    if (d.recon.needsExplanation) {
      if (!input.reason) throw new UserError("The drawer doesn't balance. Pick a reason for the difference before closing.");
      if (!note) {
        throw new UserError("Explain the difference in writing before closing. Any difference in USD or LBP needs an explanation.");
      }
    }
    // Spec 13.2: a day with nothing sold can close only when someone says why.
    const noSalesReason = input.noSalesReason?.trim() ?? "";
    if (!d.hasSales && !noSalesReason) {
      throw new UserError("No sales are recorded for this day. Import the POS file or enter the totals, or say why there were no sales.");
    }
    await tx.insert(dayClosings).values({
      orgId: scope.orgId,
      businessDayId: day.id,
      rateId: day.rateId,
      expectedUsd: d.recon.expected.USD,
      countedUsd: d.recon.counted.USD,
      varianceUsd: d.recon.variance.USD,
      expectedLbp: d.recon.expected.LBP,
      countedLbp: d.recon.counted.LBP,
      varianceLbp: d.recon.variance.LBP,
      varianceEquivCents: d.recon.varianceEquivCents,
      withinTolerance: d.recon.withinTolerance,
      varianceReason: d.recon.needsExplanation ? (input.reason ?? null) : null,
      note: note || null,
      toleranceUsdCents: d.tolerance.USD,
      toleranceLbp: d.tolerance.LBP,
      noSalesReason: d.hasSales ? null : noSalesReason,
      closedBy: scope.userId,
    });
    const closedAt = new Date();
    await tx
      .update(businessDays)
      .set({ status: "closed", closedBy: scope.userId, closedAt })
      .where(eq(businessDays.id, day.id));
    return d.recon;
  });
}

export async function addAdjustment(
  db: DB,
  scope: TenantScope,
  input: { dayId: string; currency: Currency; amountMinor: bigint; reason: string },
) {
  requireRole(scope, ["owner", "accountant"], "post adjustments");
  if (input.amountMinor === 0n) throw new UserError("Enter a non-zero amount.");
  if (!input.reason.trim()) throw new UserError("Explain the correction.");
  return withTenant(db, scope, async (tx) => {
    const [day] = await tx.select().from(businessDays).where(eq(businessDays.id, input.dayId));
    if (!day) throw new UserError("That business day doesn't exist.");
    if (day.status !== "closed") throw new UserError("Fix open days directly; adjustments are for closed days.");
    await tx.insert(adjustments).values({
      orgId: scope.orgId,
      businessDayId: day.id,
      currency: input.currency,
      amountMinor: input.amountMinor,
      reason: input.reason.trim(),
      createdBy: scope.userId,
    });
  });
}

// ---------------------------------------------------------------- reads

export function getDay(db: DB, scope: TenantScope, dayId: string) {
  return withTenant(db, scope, async (tx) => {
    const [day] = await tx.select().from(businessDays).where(eq(businessDays.id, dayId));
    if (!day) return null;
    const [location] = await tx.select().from(locations).where(eq(locations.id, day.locationId));
    const d = await computeDay(tx, day);
    const [closing] = await tx.select().from(dayClosings).where(eq(dayClosings.businessDayId, day.id));
    const adjs = await tx
      .select({
        id: adjustments.id,
        currency: adjustments.currency,
        amountMinor: adjustments.amountMinor,
        reason: adjustments.reason,
        createdAt: adjustments.createdAt,
        createdByName: users.name,
      })
      .from(adjustments)
      .leftJoin(users, eq(users.id, adjustments.createdBy))
      .where(eq(adjustments.businessDayId, day.id))
      .orderBy(asc(adjustments.createdAt));
    const categories = await tx
      .select({ id: expenseCategories.id, name: expenseCategories.name })
      .from(expenseCategories)
      .where(eq(expenseCategories.archived, false))
      .orderBy(asc(expenseCategories.position), asc(expenseCategories.name));
    const people = await tx.select({ id: users.id, name: users.name }).from(users);
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
    return {
      day,
      location,
      ...d,
      closing: closing ?? null,
      adjustments: adjs,
      categories,
      openedByName: nameOf(day.openedBy),
      closedByName: nameOf(day.closedBy),
    };
  });
}

export function listLocations(db: DB, scope: TenantScope) {
  return withTenant(db, scope, (tx) => tx.select().from(locations).orderBy(asc(locations.name)));
}

export function getDashboard(db: DB, scope: TenantScope, today = todayIn()) {
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const locs = await tx.select().from(locations).orderBy(asc(locations.name));
    const rate = await currentRate(tx);
    const dayRow = {
      id: businessDays.id,
      businessDate: businessDays.businessDate,
      status: businessDays.status,
      locationId: businessDays.locationId,
      locationName: locations.name,
      varianceEquivCents: dayClosings.varianceEquivCents,
      varianceUsd: dayClosings.varianceUsd,
      varianceLbp: dayClosings.varianceLbp,
      withinTolerance: dayClosings.withinTolerance,
      varianceReason: dayClosings.varianceReason,
      closedByName: users.name,
    };
    const base = () =>
      tx
        .select(dayRow)
        .from(businessDays)
        .innerJoin(locations, eq(locations.id, businessDays.locationId))
        .leftJoin(dayClosings, eq(dayClosings.businessDayId, businessDays.id))
        .leftJoin(users, eq(users.id, businessDays.closedBy));
    const withStatus = <T extends { status: "open" | "closed"; withinTolerance: boolean | null }>(r: T) => ({
      ...r,
      dayStatus: dayStatusOf(r, r.withinTolerance == null ? null : { withinTolerance: r.withinTolerance }),
    });
    // The recent table is a display list, so it's capped. Open days and today's days are not.
    const recent = (await base().orderBy(desc(businessDays.businessDate), asc(locations.name)).limit(30)).map(withStatus);
    const openDays = (await base().where(eq(businessDays.status, "open")).orderBy(asc(businessDays.businessDate), asc(locations.name))).map(
      withStatus,
    );
    const todays = (await base().where(eq(businessDays.businessDate, today))).map(withStatus);
    const todayByLocation = Object.fromEntries(todays.map((r) => [r.locationId, r]));
    return { org, locations: locs, rate, recent, todayByLocation, openDays, today };
  });
}

export function getAuditTrail(db: DB, scope: TenantScope, limit = 100) {
  requireRole(scope, ["owner", "accountant"], "view the audit trail");
  return withTenant(db, scope, (tx) =>
    tx
      .select({
        id: auditLog.id,
        tableName: auditLog.tableName,
        op: auditLog.op,
        rowId: auditLog.rowId,
        at: auditLog.at,
        userName: users.name,
        newData: auditLog.newData,
        oldData: auditLog.oldData,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit),
  );
}

/** Summary per client for an accountant (or anyone) with several groups. */
export async function getClientOverview(db: DB, userId: string, memberships: { orgId: string; role: Role }[]) {
  const today = todayIn();
  return Promise.all(
    memberships.map(async (m) => {
      const scope = { orgId: m.orgId, userId, role: m.role };
      return withTenant(db, scope, async (tx) => {
        const [org] = await tx.select().from(organizations).where(eq(organizations.id, m.orgId));
        const [stats] = await tx
          .select({
            openDays: sql<number>`count(*) filter (where ${businessDays.status} = 'open')`.mapWith(Number),
            closedLast7: sql<number>`count(*) filter (where ${businessDays.status} = 'closed' and ${businessDays.businessDate} > (${today}::date - 7))`.mapWith(
              Number,
            ),
            flaggedLast7: sql<number>`count(*) filter (where ${dayClosings.withinTolerance} = false and ${businessDays.businessDate} > (${today}::date - 7))`.mapWith(
              Number,
            ),
            varianceLast7: sql<string>`coalesce(sum(${dayClosings.varianceEquivCents}) filter (where ${businessDays.businessDate} > (${today}::date - 7)), 0)`,
          })
          .from(businessDays)
          .leftJoin(dayClosings, eq(dayClosings.businessDayId, businessDays.id));
        const locs = await tx.select({ id: locations.id }).from(locations);
        return {
          orgId: m.orgId,
          role: m.role,
          name: org.name,
          locationCount: locs.length,
          openDays: stats.openDays,
          closedLast7: stats.closedLast7,
          flaggedLast7: stats.flaggedLast7,
          varianceLast7Cents: BigInt(stats.varianceLast7),
        };
      });
    }),
  );
}


/** Small numbers for the sidebar badges, plus the group's plan. */
export function getNavCounts(db: DB, scope: TenantScope) {
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, scope.orgId));
    const [{ n: openDays }] = await tx.select({ n: count() }).from(businessDays).where(eq(businessDays.status, "open"));
    const [{ n: importDrafts }] = await tx.select({ n: count() }).from(posImports).where(eq(posImports.status, "draft"));
    // Invitations are only visible to owners (row-level security returns 0 for others).
    const [{ n: pendingInvites }] = await tx
      .select({ n: count() })
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    return { plan: org.plan, openDays, importDrafts, pendingInvites };
  });
}
