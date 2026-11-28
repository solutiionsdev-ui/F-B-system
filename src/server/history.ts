// Importing past business days from Excel (Settings & Log › Past days).
// Owners only. The workbook is read into a draft; the preview shows what each
// day will become (closed balanced, closed flagged, left open, or skipped and
// why); posting runs every day through the same operations as Daily Close
// (open, sales, expenses, cash movements, counts, close) inside one
// transaction, so a file goes in completely or not at all.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type DB, type TenantScope, withTenant } from "@/db/database";
import { businessDays, dayImports, exchangeRates, expenseCategories, locations, organizations, users, type VarianceReason } from "@/db/schema";
import { computeExpected, reconcile, type SalesLineInput } from "@/lib/closing";
import { readHistoryWorkbook, type HistoryDay, type HistoryPlan, type SalesKey } from "@/lib/history-workbook";
import { formatRate, parseRate, type Currency, type Pair } from "@/lib/money";
import { pickRateForDate } from "@/lib/rates";
import { readSheets } from "./kitchen";
import { addExpense, addMovement, closeDay, openDay, saveCount, saveManualSales, todayIn, UserError, type SalesTotalsInput } from "./operations";

function requireOwner(scope: TenantScope) {
  if (scope.role !== "owner") throw new UserError("Only owners import past days.");
}

const pair = (a?: { USD: string; LBP: string } | null): Pair => ({ USD: BigInt(a?.USD ?? "0"), LBP: BigInt(a?.LBP ?? "0") });

/** Category names people commonly use, matched to the eight categories. */
const CATEGORY_WORDS: [RegExp, string][] = [
  [/salar|wage|payroll|staff/i, "Salaries & Wages"],
  [/food|kitchen|meat|produce|vegetable|dairy|bakery/i, "Food & Kitchen Suppliers"],
  [/beverage|coffee|bar|drink|alcohol/i, "Beverage, Coffee & Bar Suppliers"],
  [/generator|electric|diesel|fuel|power/i, "Generator & Electricity"],
  [/rent|municipal/i, "Rent & Municipal Fees"],
  [/packag|delivery suppl|takeaway/i, "Packaging & Delivery Supplies"],
  [/clean|mainten|repair/i, "Cleaning, Maintenance & Repairs"],
  [/misc|petty|other/i, "Miscellaneous / Petty Cash"],
];

export type DayOutcome = "close_balanced" | "close_flagged" | "open" | "skip";

export type DayPreview = {
  key: string;
  branch: string;
  date: string;
  locationId: string | null;
  outcome: DayOutcome;
  /** Why a day is left open or skipped. */
  reasons: string[];
  rate: string | null;
  rateNote: string | null;
  collected: Pair;
  expected: Pair;
  counted: Pair | null;
  variance: Pair | null;
  expenses: number;
  movements: number;
};

/** What posting would do with each day, checked against what's in FINCTRL now. Pure apart from the reads. */
async function previewPlan(tx: Parameters<Parameters<typeof withTenant>[2]>[0], plan: HistoryPlan) {
  const locs = await tx.select().from(locations);
  const cats = await tx.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.archived, false));
  const rates = await tx.select().from(exchangeRates);
  const [org] = await tx.select({ usd: organizations.toleranceUsdCents, lbp: organizations.toleranceLbp }).from(organizations);
  const locByName = new Map(locs.map((l) => [l.name.trim().toLowerCase(), l]));
  const dates = [...new Set(plan.days.map((d) => d.date))];
  const existing = dates.length
    ? await tx.select({ locationId: businessDays.locationId, date: businessDays.businessDate }).from(businessDays).where(inArray(businessDays.businessDate, dates))
    : [];
  const taken = new Set(existing.map((e) => `${e.locationId}|${e.date}`));

  const categoryFor = (name: string) => {
    const exact = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    const word = CATEGORY_WORDS.find(([re]) => re.test(name));
    return word ? cats.find((c) => c.name === word[1]) : undefined;
  };

  const days: (DayPreview & { categoryIds: (string | null)[] })[] = plan.days.map((d) => {
    const reasons: string[] = [];
    const loc = locByName.get(d.branch.toLowerCase());
    const base = { key: d.key, branch: d.branch, date: d.date, expenses: d.expenses.length, movements: d.movements.length };
    const empty = { collected: { USD: 0n, LBP: 0n }, expected: { USD: 0n, LBP: 0n }, counted: null, variance: null, rate: null, rateNote: null };
    if (!loc) return { ...base, ...empty, locationId: null, outcome: "skip", reasons: [`There's no branch called "${d.branch}" that you can see.`], categoryIds: [] };
    if (loc.status === "archived") return { ...base, ...empty, locationId: loc.id, outcome: "skip", reasons: [`${loc.name} is archived.`], categoryIds: [] };
    if (taken.has(`${loc.id}|${d.date}`)) return { ...base, ...empty, locationId: loc.id, outcome: "skip", reasons: ["This branch already has a day on this date; it's left as it is."], categoryIds: [] };
    const categoryIds = d.expenses.map((e) => categoryFor(e.category)?.id ?? null);
    const unknown = d.expenses.filter((_, i) => !categoryIds[i]).map((e) => e.category);
    if (unknown.length) {
      return { ...base, ...empty, locationId: loc.id, outcome: "skip", reasons: [`Category ${[...new Set(unknown)].map((c) => `"${c}"`).join(", ")} doesn't match the expense categories.`], categoryIds };
    }
    const choice = pickRateForDate(rates, d.date, loc.timezone, new Date());
    if (!choice) return { ...base, ...empty, locationId: loc.id, outcome: "skip", reasons: ["No exchange rate is set yet."], categoryIds };
    const rate = parseRate(choice.rate.lbpPerUsd);

    const sales: SalesLineInput[] = [];
    for (const [k, v] of Object.entries(d.sales) as [SalesKey, { USD: string; LBP: string }][]) {
      for (const c of ["USD", "LBP"] as Currency[]) {
        const amountMinor = BigInt(v[c]);
        if (!amountMinor) continue;
        if (k === "cashRefunds") sales.push({ lineType: "refund", tender: "cash", currency: c, amountMinor });
        else if (k === "discounts" || k === "voids" || k === "tax") sales.push({ lineType: k === "discounts" ? "discount" : k === "voids" ? "void" : "tax", tender: null, currency: c, amountMinor });
        else sales.push({ lineType: "payment", tender: k, currency: c, amountMinor });
      }
    }
    const b = computeExpected({
      openingFloat: pair(d.float),
      sales,
      expenses: d.expenses.map((e) => ({ paidFrom: e.paidFrom, status: "active" as const, currency: e.currency, amountMinor: BigInt(e.amount) })),
      movements: d.movements.map((m) => ({ direction: "out" as const, currency: m.currency, amountMinor: BigInt(m.amount), kind: m.kind })),
    });
    const collected: Pair = { USD: 0n, LBP: 0n };
    for (const s of sales) {
      if (s.lineType === "payment") collected[s.currency] += s.amountMinor;
      if (s.lineType === "refund") collected[s.currency] -= s.amountMinor;
    }
    const hasSales = sales.some((s) => s.lineType === "payment");
    let outcome: DayOutcome = "open";
    let counted: Pair | null = null;
    let variance: Pair | null = null;
    if (!d.counted) reasons.push("No cash count in the sheet: left open to count and close.");
    else {
      counted = pair(d.counted);
      const recon = reconcile(b.expected, counted, rate, { USD: org.usd, LBP: org.lbp });
      variance = recon.variance;
      if (recon.needsExplanation && !d.note) reasons.push("The count doesn't match and the Note is empty: left open for someone to explain and close.");
      else if (!hasSales && !d.note) reasons.push("No sales and no note saying why: left open.");
      else outcome = recon.withinTolerance ? "close_balanced" : "close_flagged";
    }
    return {
      ...base,
      locationId: loc.id,
      outcome,
      reasons,
      rate: formatRate(rate),
      rateNote: choice.fallback ? "No rate was set yet on this date, so the earliest rate is used." : null,
      collected,
      expected: b.expected,
      counted,
      variance,
      categoryIds,
    };
  });
  return days;
}

export async function createDayImport(db: DB, scope: TenantScope, input: { fileName: string; bytes: Uint8Array }) {
  requireOwner(scope);
  const sheets = await readSheets(input.fileName, input.bytes, "past-days workbook");
  let plan: HistoryPlan;
  try {
    plan = readHistoryWorkbook(sheets, todayIn());
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Couldn't read that workbook.");
  }
  if (plan.days.length === 0 && !plan.issues.some((i) => i.level === "error")) {
    throw new UserError("There are no days in this workbook yet (example rows are skipped). Add your own rows and upload it again.");
  }
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx
      .insert(dayImports)
      .values({ orgId: scope.orgId, fileName: input.fileName.slice(0, 200), fileHash, plan, createdBy: scope.userId })
      .returning({ id: dayImports.id });
    return row.id;
  });
}

export async function getDayImport(db: DB, scope: TenantScope, importId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(dayImports).where(eq(dayImports.id, importId));
    if (!imp) return null;
    const plan = imp.plan as HistoryPlan;
    const days = imp.status === "draft" ? (await previewPlan(tx, plan)).map(({ categoryIds, ...d }) => (void categoryIds, d)) : [];
    const counts = { close_balanced: 0, close_flagged: 0, open: 0, skip: 0 } as Record<DayOutcome, number>;
    for (const d of days) counts[d.outcome]++;
    return { import: { ...imp, plan: undefined }, issues: plan.issues, days, counts };
  });
}

function salesTotals(d: HistoryDay): SalesTotalsInput {
  const p = (k: SalesKey) => pair(d.sales[k]);
  return {
    cash: p("cash"),
    card: p("card"),
    toters: p("toters"),
    noknok: p("noknok"),
    other: p("other"),
    cashRefunds: p("cashRefunds"),
    discounts: p("discounts"),
    voids: p("voids"),
    tax: p("tax"),
    serviceCharge: { USD: 0n, LBP: 0n },
  };
}

/**
 * Posts the checked days in one transaction through the Daily Close
 * operations: every rule (rates, notes on expenses, explanations for a
 * difference, locking) applies exactly as when a manager does it by hand.
 */
export async function postDayImport(db: DB, scope: TenantScope, importId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(dayImports).where(eq(dayImports.id, importId)).for("update");
    if (!imp) throw new UserError("That import doesn't exist.");
    if (imp.status !== "draft") throw new UserError(`This workbook was already ${imp.status}.`);
    const plan = imp.plan as HistoryPlan;
    const preview = await previewPlan(tx, plan);
    // The day operations each open their own (nested) transaction: inside this one they become savepoints.
    const inner = tx as unknown as DB;
    const summary = { closedBalanced: 0, closedFlagged: 0, leftOpen: 0, skipped: 0, expenses: 0, movements: 0, dayIds: [] as string[] };
    for (const p of preview) {
      if (p.outcome === "skip" || !p.locationId) {
        summary.skipped++;
        continue;
      }
      const d = plan.days.find((x) => x.key === p.key)!;
      const day = await openDay(inner, scope, { locationId: p.locationId, businessDate: d.date, openingFloat: pair(d.float) });
      summary.dayIds.push(day.id);
      if (Object.keys(d.sales).length) await saveManualSales(inner, scope, day.id, salesTotals(d));
      for (const [i, e] of d.expenses.entries()) {
        await addExpense(inner, scope, {
          dayId: day.id,
          categoryId: p.categoryIds[i]!,
          description: e.note,
          vendor: e.supplier,
          currency: e.currency,
          amountMinor: BigInt(e.amount),
          paidFrom: e.paidFrom,
        });
        summary.expenses++;
      }
      for (const m of d.movements) {
        await addMovement(inner, scope, { dayId: day.id, kind: m.kind, currency: m.currency, amountMinor: BigInt(m.amount), partnerName: m.partnerName, reason: m.note });
        summary.movements++;
      }
      if (d.counted) {
        for (const c of ["USD", "LBP"] as Currency[]) {
          await saveCount(inner, scope, { dayId: day.id, currency: c, denominations: {}, looseMinor: BigInt(d.counted[c]) });
        }
      }
      if (p.outcome === "close_balanced" || p.outcome === "close_flagged") {
        const note = d.note ? `${d.note} (imported from ${imp.fileName})` : `Imported from ${imp.fileName}`;
        await closeDay(inner, scope, day.id, {
          reason: p.variance && (p.variance.USD !== 0n || p.variance.LBP !== 0n) ? ((d.reason ?? "other") as VarianceReason) : null,
          note,
          noSalesReason: d.note || undefined,
        });
        if (p.outcome === "close_balanced") summary.closedBalanced++;
        else summary.closedFlagged++;
      } else summary.leftOpen++;
    }
    if (summary.dayIds.length === 0) throw new UserError("Nothing to import: every day in this workbook is skipped.");
    await tx.update(dayImports).set({ status: "posted", summary, postedBy: scope.userId, postedAt: new Date() }).where(eq(dayImports.id, imp.id));
    return summary;
  });
}

export async function discardDayImport(db: DB, scope: TenantScope, importId: string) {
  requireOwner(scope);
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx
      .update(dayImports)
      .set({ status: "discarded" })
      .where(and(eq(dayImports.id, importId), eq(dayImports.status, "draft")))
      .returning({ id: dayImports.id });
    if (!row) throw new UserError("Only a workbook that hasn't been posted can be discarded.");
  });
}

export async function listDayImports(db: DB, scope: TenantScope) {
  requireOwner(scope);
  return withTenant(db, scope, (tx) =>
    tx
      .select({ id: dayImports.id, fileName: dayImports.fileName, status: dayImports.status, createdAt: dayImports.createdAt, summary: dayImports.summary, by: users.name })
      .from(dayImports)
      .leftJoin(users, eq(users.id, dayImports.createdBy))
      .orderBy(desc(dayImports.createdAt))
      .limit(20),
  );
}
