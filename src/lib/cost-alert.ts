// The cost alert at the top of Performance: running costs now take a bigger
// share of sales than they did. Pure.
//
// Costs are every operating expense: salaries, food and drink suppliers,
// generator and electricity, rent, packaging, cleaning and repairs, petty
// cash. Cash movements (safe drops, partner withdrawals) are not costs. Sales
// are what was collected. Both in USD at each day's own rate, the same figures
// as everywhere else in Performance.
//
// It compares the cost share of sales, not costs alone: a busier month costs
// more and needs no price change, but when each dollar sold carries more cost,
// the margin is shrinking. The relative rise is also the price rise that would
// bring the share back, if the same is sold: costs C over sales S at a share
// r1, against an earlier r0, return to r0 when prices go up by r1 / r0 − 1.

/** One branch's figures over one period. */
export type PeriodTotals = {
  locationId: string;
  name: string;
  salesEq: bigint;
  costsEq: bigint;
  /** Business days with sales recorded. */
  salesDays: number;
  /** Costs by expense category. */
  categories: Record<string, bigint>;
};

/** A branch needs at least this many days with sales in each period to be compared. */
export const MIN_SALES_DAYS = 7;
export const DEFAULT_ALERT_BP = 500;

export type CostShare = {
  salesNow: bigint;
  salesBefore: bigint;
  costsNow: bigint;
  costsBefore: bigint;
  /** Costs as a share of sales, in basis points (6000 = 60%). */
  shareNowBp: number;
  shareBeforeBp: number;
  /** How much bigger the share is now, relative (1000 = 10% bigger); negative when smaller. */
  riseBp: number;
  costsChangeBp: number;
  salesChangeBp: number;
};

export type CategoryChange = {
  name: string;
  nowEq: bigint;
  beforeEq: bigint;
  shareNowBp: number;
  shareBeforeBp: number;
  /** Change in this category's share of sales, in percentage points × 100. */
  pointsBp: number;
};

export type CostAlert = {
  thresholdBp: number;
  /** Across the branches that can be compared; null when none can. */
  overall: CostShare | null;
  branches: (CostShare & { locationId: string; name: string; over: boolean })[];
  /** Categories across the compared branches, biggest increase in share first. */
  categories: CategoryChange[];
  /** Branches left out for lack of history in one of the periods. */
  notCompared: string[];
  /** Whether to show the alert: the overall share, or one branch's, rose by the threshold or more. */
  show: boolean;
};

/** n / d rounded half away from zero, as a number; d > 0. */
function ratio(n: bigint, d: bigint): number {
  const q = n / d;
  const r = n % d;
  const abs = r < 0n ? -r : r;
  return Number(2n * abs >= d ? q + (n < 0n ? -1n : 1n) : q);
}

function share(costsNow: bigint, salesNow: bigint, costsBefore: bigint, salesBefore: bigint): CostShare {
  return {
    salesNow,
    salesBefore,
    costsNow,
    costsBefore,
    shareNowBp: ratio(costsNow * 10_000n, salesNow),
    shareBeforeBp: ratio(costsBefore * 10_000n, salesBefore),
    riseBp: ratio(costsNow * salesBefore * 10_000n, costsBefore * salesNow) - 10_000,
    costsChangeBp: ratio((costsNow - costsBefore) * 10_000n, costsBefore),
    salesChangeBp: ratio((salesNow - salesBefore) * 10_000n, salesBefore),
  };
}

export function comparable(now: PeriodTotals | undefined, before: PeriodTotals | undefined): boolean {
  return (
    !!now &&
    !!before &&
    now.salesDays >= MIN_SALES_DAYS &&
    before.salesDays >= MIN_SALES_DAYS &&
    now.salesEq > 0n &&
    before.salesEq > 0n &&
    before.costsEq > 0n
  );
}

export function costAlert(now: PeriodTotals[], before: PeriodTotals[], thresholdBp = DEFAULT_ALERT_BP): CostAlert {
  const beforeOf = new Map(before.map((b) => [b.locationId, b]));
  const ids = [...new Set([...now.map((n) => n.locationId), ...before.map((b) => b.locationId)])];
  const nowOf = new Map(now.map((n) => [n.locationId, n]));
  const pairs = ids.map((id) => ({ id, now: nowOf.get(id), before: beforeOf.get(id) }));
  const compared = pairs.filter((p) => comparable(p.now, p.before)) as { id: string; now: PeriodTotals; before: PeriodTotals }[];
  const notCompared = pairs
    .filter((p) => !compared.includes(p as (typeof compared)[number]))
    .map((p) => (p.now ?? p.before)!.name)
    .sort();

  const branches = compared
    .map((p) => {
      const s = share(p.now.costsEq, p.now.salesEq, p.before.costsEq, p.before.salesEq);
      return { ...s, locationId: p.id, name: p.now.name, over: s.riseBp >= thresholdBp };
    })
    .sort((a, b) => b.riseBp - a.riseBp || a.name.localeCompare(b.name));

  if (compared.length === 0) return { thresholdBp, overall: null, branches: [], categories: [], notCompared, show: false };

  const sum = (rows: PeriodTotals[], k: "salesEq" | "costsEq") => rows.reduce((s, r) => s + r[k], 0n);
  const nowRows = compared.map((p) => p.now);
  const beforeRows = compared.map((p) => p.before);
  const salesNow = sum(nowRows, "salesEq");
  const salesBefore = sum(beforeRows, "salesEq");
  const overall = share(sum(nowRows, "costsEq"), salesNow, sum(beforeRows, "costsEq"), salesBefore);

  const names = new Set([...nowRows, ...beforeRows].flatMap((r) => Object.keys(r.categories)));
  const categories = [...names]
    .map((name) => {
      const nowEq = nowRows.reduce((s, r) => s + (r.categories[name] ?? 0n), 0n);
      const beforeEq = beforeRows.reduce((s, r) => s + (r.categories[name] ?? 0n), 0n);
      const shareNowBp = ratio(nowEq * 10_000n, salesNow);
      const shareBeforeBp = ratio(beforeEq * 10_000n, salesBefore);
      return { name, nowEq, beforeEq, shareNowBp, shareBeforeBp, pointsBp: shareNowBp - shareBeforeBp };
    })
    .filter((c) => c.nowEq !== 0n || c.beforeEq !== 0n)
    .sort((a, b) => b.pointsBp - a.pointsBp || a.name.localeCompare(b.name));

  const show = overall.riseBp >= thresholdBp || (branches.length > 1 && branches.some((b) => b.over));
  return { thresholdBp, overall, branches, categories, notCompared, show };
}
