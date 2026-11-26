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
import { can, type Permission } from "@/lib/permissions";
import { pickRateForDate } from "@/lib/rates";
import { isMovementKind, MOVEMENT_KINDS, movementDirection, type MovementKind } from "@/lib/expense-buckets";
import { CURRENCIES, countTotal, parseRate, rateToDb, RATE_SCALE, type Pair } from "@/lib/money";

/** An error whose message is safe and useful to show to the person. */
export class UserError extends Error {}

export const BEIRUT_TZ = "Asia/Beirut";

export function todayIn(timeZone = BEIRUT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Checks the permission matrix (lib/permissions.ts); the database checks it again. */
export function requirePermission(scope: TenantScope, permission: Permission, action: string) {
  if (!can(scope, permission)) throw new UserError(`You don't have permission to ${action}.`);
}

/**
 * Serializes everything that writes to one business day (entries, counts,
 * imports, closing), so nothing can slip in while the day is being closed.
 * An advisory lock rather than SELECT ... FOR UPDATE, which the database would
 * treat as editing the day itself and refuse to people who may only add
 * entries to it.
 */
export async function lockDay(tx: Tx, dayId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(727102, hashtext(${dayId}))`);
}

async function loadOpenDay(tx: Tx, dayId: string) {
  await lockDay(tx, dayId);
  const [day] = await tx.select().from(businessDays).where(eq(businessDays.id, dayId));
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
  requirePermission(scope, "change_rate", "change the exchange rate");
  // v2.1: every rate says where it came from; there is no silent default.
  if (!["market", "bank", "custom"].includes(input.source)) throw new UserError("Choose where the rate comes from: market, bank or other.");
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
  requirePermission(scope, "close_days", "open a business day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) throw new UserError("Pick a valid business date.");
  return withTenant(db, scope, async (tx) => {
    const [location] = await tx.select().from(locations).where(eq(locations.id, input.locationId));
    if (!location) throw new UserError("Pick a location.");
    if (location.status === "archived") throw new UserError(`${location.name} is archived. Restore it in Settings to open days there.`);
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

export type SalesTotalsInput = {
  cash: Pair;
  card: Pair;
  /** Delivery apps: collected sales held by the app until it pays out. Never drawer cash. */
  toters: Pair;
  noknok: Pair;
  other: Pair;
  cashRefunds: Pair;
  discounts: Pair;
  voids: Pair;
  tax: Pair;
  serviceCharge: Pair;
};

/** Replaces the hand-entered POS end-of-day totals for a day. */
export async function saveManualSales(db: DB, scope: TenantScope, dayId: string, totals: SalesTotalsInput) {
  requirePermission(scope, "import_pos", "enter sales");
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
    add("payment", "toters", totals.toters);
    add("payment", "noknok", totals.noknok);
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
    /** Notes: what it was for (supplier, purpose or payroll period). Required. */
    description?: string;
    vendor?: string;
    receiptRef?: string;
    currency: Currency;
    amountMinor: bigint;
    paidFrom: PaidFrom;
  },
) {
  requirePermission(scope, "record_transactions", "record expenses");
  if (input.amountMinor <= 0n) throw new UserError("Enter an amount greater than zero.");
  if (!input.categoryId) throw new UserError("Pick a category for the expense.");
  // Spec 9.3: every operating expense says what it was for.
  if (!input.description?.trim()) throw new UserError("Add a note saying what the expense was for.");
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
  requirePermission(scope, "record_transactions", "void expenses");
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

/**
 * Records a cash movement (bucket B): it changes the cash expected in the
 * drawer and is never an operating expense.
 *  - Safe drop / bank deposit: cash out of the drawer.
 *  - Partner withdrawal: cash out, with the partner's name.
 *  - Opening float adjustment: adds to or reduces the float the day started
 *    with; the original float is kept and a reason is required.
 */
export async function addMovement(
  db: DB,
  scope: TenantScope,
  input: {
    dayId: string;
    kind: MovementKind;
    currency: Currency;
    amountMinor: bigint;
    reason?: string;
    partnerName?: string;
    /** Float adjustments only: "in" adds to the float, "out" reduces it. */
    direction?: "in" | "out";
  },
) {
  if (!isMovementKind(input.kind)) throw new UserError("Pick what kind of cash movement this is.");
  const type = MOVEMENT_KINDS.find((k) => k.kind === input.kind)!;
  if (!type.offered) {
    throw new UserError("Record this as a safe drop / bank deposit, a partner withdrawal or an opening float adjustment.");
  }
  const isFloat = input.kind === "float_adjustment";
  if (isFloat) requirePermission(scope, "close_days", "adjust the opening float");
  else requirePermission(scope, "record_transactions", "record cash movements");
  if (input.amountMinor <= 0n) throw new UserError("Enter an amount greater than zero.");
  const reason = input.reason?.trim() ?? "";
  const partnerName = input.partnerName?.trim().replace(/\s+/g, " ").slice(0, 80) || null;
  if (input.kind === "partner_withdrawal" && !partnerName) throw new UserError("Enter the partner's name for a partner withdrawal.");
  if (isFloat && !reason) throw new UserError("Give a reason for adjusting the opening float.");
  if (isFloat && input.direction !== "in" && input.direction !== "out") {
    throw new UserError("Say whether the adjustment adds to the opening float or reduces it.");
  }
  const direction = movementDirection(input.kind) ?? input.direction!;
  return withTenant(db, scope, async (tx) => {
    const day = await loadOpenDay(tx, input.dayId);
    if (isFloat && direction === "out") {
      // The adjusted float can't go below zero.
      const prior = await tx
        .select()
        .from(cashMovements)
        .where(and(eq(cashMovements.businessDayId, day.id), eq(cashMovements.kind, "float_adjustment"), eq(cashMovements.currency, input.currency)));
      const adjusted =
        (input.currency === "USD" ? day.openingFloatUsd : day.openingFloatLbp) +
        prior.reduce((sum, m) => sum + (m.direction === "in" ? m.amountMinor : -m.amountMinor), 0n);
      if (input.amountMinor > adjusted) throw new UserError("That would take the opening float below zero.");
    }
    await tx.insert(cashMovements).values({
      orgId: scope.orgId,
      businessDayId: day.id,
      kind: input.kind,
      direction,
      currency: input.currency,
      amountMinor: input.amountMinor,
      reason,
      partnerName: input.kind === "partner_withdrawal" ? partnerName : null,
      createdBy: scope.userId,
    });
  });
}

export async function deleteMovement(db: DB, scope: TenantScope, movementId: string) {
  return withTenant(db, scope, async (tx) => {
    const [m] = await tx.select().from(cashMovements).where(eq(cashMovements.id, movementId));
    if (!m) throw new UserError("That cash movement doesn't exist.");
    if (m.kind === "float_adjustment") requirePermission(scope, "close_days", "remove opening float adjustments");
    else requirePermission(scope, "record_transactions", "remove cash movements");
    await loadOpenDay(tx, m.businessDayId);
    await tx.delete(cashMovements).where(eq(cashMovements.id, movementId));
  });
}

// ---------------------------------------------------------------- counting & closing

export async function saveCount(
  db: DB,
  scope: TenantScope,
  input: { dayId: string; currency: Currency; denominations: Record<string, number>; looseMinor: bigint },
) {
  requirePermission(scope, "close_days", "count the drawer");
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
  requirePermission(scope, "close_days", "close a business day");
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
  requirePermission(scope, "post_corrections", "post corrections on closed days");
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

/**
 * The Today page's lists. `locationId` is the branch picked in the sidebar
 * (null for all branches); row-level security already limits everything to
 * the venues this person may see.
 */
export function getDashboard(db: DB, scope: TenantScope, today = todayIn(), locationId: string | null = null) {
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, scope.orgId));
    const locs = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.status, "active"), locationId ? eq(locations.id, locationId) : undefined))
      .orderBy(asc(locations.name));
    const atBranch = locationId ? eq(businessDays.locationId, locationId) : undefined;
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
    const recent = (await base().where(atBranch).orderBy(desc(businessDays.businessDate), asc(locations.name)).limit(30)).map(withStatus);
    const openDays = (
      await base()
        .where(and(eq(businessDays.status, "open"), atBranch))
        .orderBy(asc(businessDays.businessDate), asc(locations.name))
    ).map(withStatus);
    const todays = (await base().where(and(eq(businessDays.businessDate, today), atBranch))).map(withStatus);
    const todayByLocation = Object.fromEntries(todays.map((r) => [r.locationId, r]));
    return { org, locations: locs, rate, recent, todayByLocation, openDays, today };
  });
}

export type AuditFilter = {
  limit?: number;
  /** One person's changes. */
  userId?: string | null;
  /** One kind of record (a table name, e.g. "expenses"). */
  table?: string | null;
  /** Business-calendar dates in Beirut, inclusive. */
  from?: string | null;
  to?: string | null;
};

/**
 * The append-only audit trail, newest first, with optional filters. Row-level
 * security keeps it to the person's venues (team changes stay with owners).
 */
export async function getAuditTrail(db: DB, scope: TenantScope, filter: AuditFilter | number = {}) {
  requirePermission(scope, "view_audit", "see the audit trail");
  const f: AuditFilter = typeof filter === "number" ? { limit: filter } : filter;
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return withTenant(db, scope, async (tx) => {
    const where = and(
      f.userId ? eq(auditLog.userId, f.userId) : undefined,
      f.table ? eq(auditLog.tableName, f.table) : undefined,
      f.from && iso.test(f.from) ? sql`(${auditLog.at} at time zone ${BEIRUT_TZ})::date >= ${f.from}::date` : undefined,
      f.to && iso.test(f.to) ? sql`(${auditLog.at} at time zone ${BEIRUT_TZ})::date <= ${f.to}::date` : undefined,
    );
    const rows = await tx
      .select({
        id: auditLog.id,
        tableName: auditLog.tableName,
        op: auditLog.op,
        rowId: auditLog.rowId,
        at: auditLog.at,
        userId: auditLog.userId,
        userName: users.name,
        newData: auditLog.newData,
        oldData: auditLog.oldData,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);
    // Who appears in the trail at all, for the person filter.
    const people = await tx
      .selectDistinct({ id: auditLog.userId, name: users.name })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.userId));
    const tables = await tx.selectDistinct({ table: auditLog.tableName }).from(auditLog);
    return {
      rows,
      people: people.filter((p): p is { id: string; name: string } => Boolean(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
      tables: tables.map((t) => t.table).sort(),
      limit,
    };
  });
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
export function getNavCounts(db: DB, scope: TenantScope, locationId: string | null = null) {
  return withTenant(db, scope, async (tx) => {
    const [org] = await tx.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, scope.orgId));
    const [{ n: openDays }] = await tx
      .select({ n: count() })
      .from(businessDays)
      .where(and(eq(businessDays.status, "open"), locationId ? eq(businessDays.locationId, locationId) : undefined));
    const [{ n: importDrafts }] = await tx
      .select({ n: count() })
      .from(posImports)
      .where(and(eq(posImports.status, "draft"), locationId ? eq(posImports.locationId, locationId) : undefined));
    // Invitations are only visible to owners (row-level security returns 0 for others).
    const [{ n: pendingInvites }] = await tx
      .select({ n: count() })
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    return { plan: org.plan, openDays, importDrafts, pendingInvites };
  });
}
