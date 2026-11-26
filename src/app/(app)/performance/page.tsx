import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  Badge,
  buttonClass,
  Card,
  Delta,
  Kpi,
  formatDate,
  Money,
  PAID_FROM_LABELS,
  REASON_LABELS,
  type Tone,
} from "@/components/ui";
import { formatAmount, formatRate, type Pair } from "@/lib/money";
import { branchLabel, requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { todayIn, UserError } from "@/server/operations";
import { dailyTotals, getComparison, getPeriodReport, type PeriodReport } from "@/server/reports";
import { getToday, type AttentionItem } from "@/server/today";
import { PeriodFilter, readPeriod, type PeriodSearch } from "@/components/period-filter";
import { TrendChart } from "@/components/charts/trend-chart";
import { CashCalendar } from "@/components/charts/cash-calendar";
import { QuickActions } from "../quick-actions";
import { PerformanceHeader } from "./header";

const ICON_TONE: Record<AttentionItem["tone"], string> = {
  bad: "bg-red-50 text-red-600",
  warn: "bg-amber-50 text-amber-600",
  accent: "bg-amber-50 text-amber-700",
  neutral: "bg-stone-100 text-stone-500",
  info: "bg-sky-50 text-sky-600",
};

/** What needs someone's attention first (flagged days, days left open, unposted files), each with its quickest action. */
function NeedsAttention({ items, orgName }: { items: AttentionItem[]; orgName: string }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-6 rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <header className="flex items-center gap-2 px-5 pb-1 pt-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">Needs attention</h2>
        <span className="num rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">{items.length}</span>
      </header>
      <ul className="grid divide-y divide-stone-100 lg:grid-cols-2 lg:divide-y-0">
        {items.slice(0, 6).map((item) => (
          <li key={item.key} className="px-5 py-3">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ICON_TONE[item.tone]}`}>
                <Icon name={item.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link href={item.href} className="line-clamp-2 min-w-0 text-sm font-semibold text-stone-900 hover:underline">
                    {item.title}
                  </Link>
                  <Badge tone={item.tone as Tone}>{item.pill}</Badge>
                </div>
                <p className="mt-0.5 text-[13px] leading-5 text-stone-500">{item.detail}</p>
                {item.actions.length > 0 && (
                  <div className="mt-2">
                    <QuickActions actions={item.actions} orgName={orgName} />
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function change(cur: bigint, prev: bigint | undefined) {
  if (prev == null || prev === 0n) return null;
  return (Number(cur - prev) / Math.abs(Number(prev))) * 100;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const ctx = await requireContext();
  if (!ctx.can("view_reports")) {
    return (
      <>
        <h1 className="mb-4 text-[26px] font-semibold tracking-tight text-stone-900">Performance</h1>
        <Card>
          <p className="text-sm text-stone-600">Performance is for owners and accountants. An owner can give you read-only access in Team &amp; Permissions.</p>
        </Card>
      </>
    );
  }

  const sp = await searchParams;
  const today = todayIn();
  const filter = readPeriod(sp, today, ctx.branch?.id ?? null);
  const db = await getDb();
  let report: PeriodReport;
  let comparison: Awaited<ReturnType<typeof getComparison>> | null;
  let needs: AttentionItem[] = [];
  try {
    report = await getPeriodReport(db, ctx.scope, filter);
    comparison = await getComparison(db, ctx.scope, filter);
    needs = (await getToday(db, ctx.scope, today, ctx.branch?.id ?? null)).needs;
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return (
      <>
        <PerformanceHeader ctx={ctx} />
        <Card>
          <p className="text-sm text-red-700">{e.message}</p>
          <Link href="/performance" className={`${buttonClass("secondary")} mt-3`}>
            Back to this month
          </Link>
        </Card>
      </>
    );
  }
  if (comparison && comparison.days === 0) comparison = null;

  const q = new URLSearchParams({ from: report.filter.from, to: report.filter.to });
  if (report.filter.locationId) q.set("location", report.filter.locationId);
  const exportUrl = (extra: Record<string, string>) => `/reports/export?${new URLSearchParams({ ...Object.fromEntries(q), ...extra })}`;
  const t = report.totals;
  const c = report.cash;

  return (
    <>
      <PerformanceHeader ctx={ctx} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          {formatDate(report.filter.from)} to {formatDate(report.filter.to)} · {report.location?.name ?? "All branches"}
          {report.rates.min != null && (
            <>
              {" "}
              · rate {formatRate(report.rates.min)}
              {report.rates.max !== report.rates.min && <>–{formatRate(report.rates.max!)}</>} LBP/$
            </>
          )}
        </p>
        {ctx.can("export_reports") && (
          <div className="flex flex-wrap gap-2">
            <a href={exportUrl({ format: "pdf" })} className={buttonClass("primary")} download>
              Accountant PDF
            </a>
            <a href={exportUrl({ format: "csv", kind: "daily" })} className={buttonClass("secondary")} download>
              Daily CSV
            </a>
            <a href={exportUrl({ format: "csv", kind: "expenses" })} className={buttonClass("secondary")} download>
              Expenses CSV
            </a>
          </div>
        )}
      </div>

      <PeriodFilter basePath="/performance" filter={report.filter} branchLabel={branchLabel(ctx)} today={today} />

      <NeedsAttention items={needs} orgName={ctx.active.orgName} />

      {c.openDays.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            {c.openDays.length} day{c.openDays.length === 1 ? " is" : "s are"} still open
          </span>
          , so {c.openDays.length === 1 ? "its" : "their"} figures aren&apos;t final:{" "}
          {c.openDays.map((d, i) => (
            <span key={d.dayId}>
              {i > 0 && ", "}
              <Link href={`/days/${d.dayId}`} className="underline">
                {d.locationName} {formatDate(d.date, { day: "numeric", month: "short" })}
              </Link>
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Total collected"
          value={<Money minor={t.salesEq.collected} currency="USD" />}
          chip={<Delta pct={change(t.salesEq.collected, comparison?.collectedEq)} label="vs previous period" />}
          sub={comparison ? "vs the previous period of the same length" : "No earlier period to compare"}
        />
        <Kpi
          label="Operating expenses"
          value={<Money minor={t.expensesEq} currency="USD" />}
          chip={<Delta pct={change(t.expensesEq, comparison?.expensesEq)} upIsGood={false} label="vs previous period" />}
          sub={`${report.categories.length} categories · safe drops and withdrawals not included`}
        />
        <Kpi
          label="Cash-view remainder"
          value={<Money minor={t.cashResultEq} currency="USD" />}
          chip={<Delta pct={change(t.cashResultEq, comparison?.cashResultEq)} label="vs previous period" />}
          sub={
            t.salesEq.collected > 0n
              ? `${(Number((t.cashResultEq * 1000n) / t.salesEq.collected) / 10).toFixed(1)}% of collected · collected less recorded operating expenses. Not cash on hand, not profit`
              : "Collected less recorded operating expenses. Not cash on hand, not profit"
          }
        />
        <Kpi
          label="Drawer variances"
          value={
            <span className="block space-y-1">
              <Money minor={c.varianceAfter.USD} currency="USD" signed variance className="block" />
              <Money minor={c.varianceAfter.LBP} currency="LBP" signed variance className="block text-lg" />
            </span>
          }
          chip={c.status.flagged ? <Badge tone="bad">{c.status.flagged} flagged</Badge> : <Badge tone="good">None flagged</Badge>}
          sub={`USD and LBP kept apart · ${c.status.closed} closed days · after corrections`}
        />
      </div>
      <p className="mb-8 text-xs text-stone-500">
        <span className="font-medium text-stone-700">Not net profit, not an audited margin.</span> The cash-view remainder is collected less
        recorded operating expenses and still includes VAT collected; physical drawer cash is shown separately in the branch comparison. All
        $ figures use each day&apos;s own exchange rate, from the same calculation Daily Close uses.
      </p>

      <BranchComparison r={report} />

      <div className="mb-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card
          title="Collected per day"
          description="All payment methods, after refunds, in USD at each day's rate."
          actions={
            <div className="flex items-center gap-4 font-mono text-[10.5px] uppercase tracking-[0.06em] text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded-full bg-brand-600" /> This period
              </span>
              {comparison && (
                <span className="flex items-center gap-1.5">
                  <span className="w-4 border-t-[1.5px] border-dashed border-[#898781]" /> Previous period
                </span>
              )}
            </div>
          }
        >
          <TrendChart
            points={dailyTotals(report).map((d, i) => ({
              date: d.date,
              value: Number(d.collectedEq),
              prevDate: comparison?.daily[i]?.date ?? null,
              prev: comparison?.daily[i] ? Number(comparison.daily[i].collectedEq) : null,
            }))}
          />
        </Card>
        <Card title="Drawer variance by day" description="Reference view in USD at each day's rate. The daily table below keeps USD and LBP apart.">
          <CashCalendar
            days={dailyTotals(report).map((d) => ({
              date: d.date,
              varianceAfterEq: Number(d.varianceAfterEq),
              closed: d.closed,
              open: d.open,
              flagged: d.flagged,
            }))}
          />
        </Card>
      </div>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <SalesCard r={report} />
        <ExpensesCard r={report} />
      </div>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <Card
          title="Cash control"
          description={
            report.org.tolerance.USD === 0n && report.org.tolerance.LBP === 0n
              ? "Each currency is checked on its own. A day is flagged when either drawer is off at all."
              : `Each currency is checked on its own. A day is flagged when the USD drawer is off by more than ${formatAmount(report.org.tolerance.USD, "USD")} or the LBP drawer by more than ${formatAmount(report.org.tolerance.LBP, "LBP")}.`
          }
        >
          <dl className="space-y-1.5 text-sm">
            <Row label="Business days" value={String(c.status.records)} />
            <Row label="Closed and locked" value={String(c.status.closed)} />
            <Row label="Balanced" value={String(c.status.balanced)} />
            <Row label="Flagged" value={<span className={c.status.flagged ? "font-medium text-red-700" : ""}>{c.status.flagged}</span>} />
            <Row label="Open" value={<span className={c.status.open ? "font-medium text-amber-700" : ""}>{c.status.open}</span>} />
            <Row
              label="Difference at closing"
              value={
                <span className="text-right">
                  <Money minor={c.variance.USD} currency="USD" signed variance /> ·{" "}
                  <Money minor={c.variance.LBP} currency="LBP" signed variance />
                </span>
              }
            />
            <Row
              label="Difference after corrections"
              value={
                <span className="text-right">
                  <Money minor={c.varianceAfter.USD} currency="USD" signed variance /> ·{" "}
                  <Money minor={c.varianceAfter.LBP} currency="LBP" signed variance />
                </span>
              }
            />
            <div className="border-t border-stone-200 pt-1.5 text-xs text-stone-500">In USD at each day&apos;s rate, for reference only:</div>
            <Row label="Shortages ≈" value={<Money minor={c.shortEq} currency="USD" signed variance />} />
            <Row label="Overages ≈" value={<Money minor={c.overEq} currency="USD" signed variance />} />
            <Row label="Corrections after closing ≈" value={<Money minor={c.adjustmentsEq} currency="USD" signed />} />
            <Row label="Net after corrections ≈" value={<Money minor={c.netAfterAdjustmentsEq} currency="USD" signed variance />} />
          </dl>
          {c.reasons.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {c.reasons.map((x) => (
                <Badge key={x.reason} tone="bad">
                  {REASON_LABELS[x.reason]} × {x.count}
                </Badge>
              ))}
            </div>
          )}
        </Card>
        <div className="grid min-w-0 gap-6">
          <MovementsCard r={report} />
        </div>
      </div>

      <Card title="Daily detail and closing history" description="Variance per currency, after any corrections. Click a day to open it in Daily Close.">
        {report.daily.length === 0 ? (
          <p className="text-sm text-stone-500">No business days in this period.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5 text-right">Rate</th>
                  <th className="px-3 py-2.5 text-right">Collected</th>
                  <th className="px-3 py-2.5 text-right">Expenses</th>
                  <th className="px-3 py-2.5 text-right">Difference</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {report.daily.map((d) => (
                  <tr key={d.dayId} className="hover:bg-stone-50">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <Link href={`/days/${d.dayId}`} className="font-medium text-stone-900 hover:underline">
                        {formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{d.locationName}</td>
                    <td className="num px-3 py-2.5 text-right text-stone-500">{formatRate(d.rate)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Money minor={d.salesEq.collected} currency="USD" />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Money minor={d.expensesEq} currency="USD" />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {d.varianceAfter == null ? (
                        <span className="text-stone-400">—</span>
                      ) : (
                        <>
                          <Money minor={d.varianceAfter.USD} currency="USD" signed variance className="block" />
                          <Money minor={d.varianceAfter.LBP} currency="LBP" signed variance className="block text-xs" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      {d.dayStatus === "open" ? (
                        <Badge tone="info">Open</Badge>
                      ) : d.dayStatus === "closed_balanced" ? (
                        <Badge tone="good">Balanced</Badge>
                      ) : (
                        <Badge tone="bad">{d.closing?.reason ? `Flagged · ${REASON_LABELS[d.closing.reason]}` : "Flagged"}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-stone-600">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function PairCells({ p, eq }: { p: Pair; eq: bigint }) {
  return (
    <>
      <td className="py-1.5 text-right">
        <Money minor={p.USD} currency="USD" className={p.USD === 0n ? "text-stone-400" : ""} />
      </td>
      <td className="py-1.5 pl-3 text-right">
        <Money minor={p.LBP} currency="LBP" className={p.LBP === 0n ? "text-stone-400" : ""} />
      </td>
      <td className="py-1.5 pl-3 text-right text-stone-600">
        <Money minor={eq} currency="USD" />
      </td>
    </>
  );
}

function SalesCard({ r }: { r: PeriodReport }) {
  const s = r.totals.sales;
  const e = r.totals.salesEq;
  const neg = (p: Pair): Pair => ({ USD: -p.USD, LBP: -p.LBP });
  const rows: { label: string; p: Pair; eq: bigint; strong?: boolean; memo?: boolean }[] = [
    { label: "Cash", p: s.byTender.cash, eq: e.cash },
    { label: "Card", p: s.byTender.card, eq: e.card },
    { label: "Delivery apps: Toters", p: s.byTender.toters, eq: e.toters },
    { label: "Delivery apps: NokNok", p: s.byTender.noknok, eq: e.noknok },
    { label: "Other", p: s.byTender.other, eq: e.other },
    { label: "Less refunds", p: neg(s.refunds), eq: -e.refunds },
    { label: "Collected", p: s.collected, eq: e.collected, strong: true },
    { label: "Discounts", p: s.discounts, eq: e.discounts, memo: true },
    { label: "Voids", p: s.voids, eq: e.voids, memo: true },
    { label: "VAT included", p: s.tax, eq: e.tax, memo: true },
    { label: "Service charge", p: s.serviceCharge, eq: e.serviceCharge, memo: true },
  ];
  return (
    <Card title="Sales" description="From the POS end-of-day totals.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
              <th />
              <th className="pb-2 font-medium">USD</th>
              <th className="pb-2 pl-3 font-medium">LBP</th>
              <th className="pb-2 pl-3 font-medium">≈ USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className={`${row.strong ? "border-t border-stone-300 font-semibold text-stone-900" : row.memo ? "text-stone-500" : "text-stone-700"}`}
              >
                <td className="py-1.5 pr-2">
                  {row.label}
                  {row.memo && <span className="ml-1 text-[10px] text-stone-400">memo</span>}
                </td>
                <PairCells p={row.p} eq={row.eq} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ExpensesCard({ r }: { r: PeriodReport }) {
  const total = r.totals.expensesEq;
  return (
    <Card
      title="Operating expenses"
      description={`These reduce profit. Active expenses${r.totals.voidedExpenses ? ` (${r.totals.voidedExpenses} voided left out)` : ""}, converted at each expense's own rate.`}
    >
      {r.categories.length === 0 ? (
        <p className="text-sm text-stone-500">No expenses in this period.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {r.categories.map((cat) => {
            const share = total > 0n ? Number((cat.eq * 1000n) / total) / 10 : 0;
            return (
              <li key={cat.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-stone-800">
                    {cat.name} <span className="text-xs text-stone-400">× {cat.count}</span>
                  </span>
                  <span className="text-right">
                    <Money minor={cat.eq} currency="USD" className="font-medium" />
                    <span className="ml-2 w-10 text-xs text-stone-500">{share.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100">
                  <div className="h-1.5 rounded-full bg-stone-700" style={{ width: `${Math.max(share, 1)}%` }} />
                </div>
              </li>
            );
          })}
          <li className="flex items-baseline justify-between border-t border-stone-200 pt-2 font-semibold text-stone-900">
            <span>Total</span>
            <Money minor={total} currency="USD" />
          </li>
          <li className="text-xs text-stone-500">
            Paid with:{" "}
            {r.paidFrom.map((p, i) => (
              <span key={p.paidFrom}>
                {i > 0 && " · "}
                {PAID_FROM_LABELS[p.paidFrom]} <Money minor={p.eq} currency="USD" />
              </span>
            ))}
          </li>
        </ul>
      )}
    </Card>
  );
}

function MovementsCard({ r }: { r: PeriodReport }) {
  return (
    <Card title="Cash movements" description="Cash that changed place without being a cost. Not counted in expenses or profit.">
      {r.movements.length === 0 ? (
        <p className="text-sm text-stone-500">No safe drops, deposits or withdrawals in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <th />
                <th className="pb-2 font-medium">USD</th>
                <th className="pb-2 pl-3 font-medium">LBP</th>
                <th className="pb-2 pl-3 font-medium">≈ USD</th>
              </tr>
            </thead>
            <tbody>
              {r.movements.map((m) => (
                <tr key={m.kind} className="text-stone-700">
                  <td className="py-1.5 pr-2">
                    {m.label} <span className="whitespace-nowrap text-xs text-stone-400">× {m.count}</span>
                    {m.direction === "in" && <span className="ml-1 text-[10px] text-stone-400">in</span>}
                  </td>
                  <PairCells p={m.pair} eq={m.eq} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Branch comparison (v2.1): each branch side by side, drawer variances per currency, and the physical cash found at its last close. */
function BranchComparison({ r }: { r: PeriodReport }) {
  if (r.byLocation.length === 0) return null;
  const pct = (part: bigint, whole: bigint) => (whole > 0n ? `${(Number((part * 1000n) / whole) / 10).toFixed(1)}%` : "—");
  return (
    <Card
      className="mb-6"
      title={r.byLocation.length > 1 ? "Branch comparison" : "Branch"}
      description="Cash-view remainder is collected less recorded operating expenses. The last drawer count is the physical cash found at the branch's latest close in this period."
    >
      <div className="-mx-5 -my-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
            <tr>
              <th className="px-5 py-2.5">Branch</th>
              <th className="px-3 py-2.5 text-right">Collected</th>
              <th className="px-3 py-2.5 text-right">Operating expenses</th>
              <th className="px-3 py-2.5 text-right">Cash-view remainder</th>
              <th className="px-3 py-2.5 text-right">Variance USD</th>
              <th className="px-3 py-2.5 text-right">Variance LBP</th>
              <th className="px-5 py-2.5 text-right">Last drawer count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {r.byLocation.map((l) => (
              <tr key={l.locationId} className="align-top">
                <td className="px-5 py-3">
                  <div className="font-medium text-stone-800">{l.name}</div>
                  <div className="text-xs text-stone-500">
                    {l.closedDays}/{l.days} days closed{l.flaggedDays ? ` · ${l.flaggedDays} flagged` : ""}
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={l.collectedEq} currency="USD" />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={l.expensesEq} currency="USD" />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={l.cashResultEq} currency="USD" className="font-medium" />
                  <div className="text-xs text-stone-500">{pct(l.cashResultEq, l.collectedEq)} of collected</div>
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={l.varianceAfter.USD} currency="USD" signed variance />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money minor={l.varianceAfter.LBP} currency="LBP" signed variance />
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-stone-700">
                  {l.lastCount ? (
                    <>
                      <div>
                        <Money minor={l.lastCount.counted.USD} currency="USD" /> · <Money minor={l.lastCount.counted.LBP} currency="LBP" />
                      </div>
                      <div className="text-xs text-stone-500">at close, {formatDate(l.lastCount.date, { day: "numeric", month: "short" })}</div>
                    </>
                  ) : (
                    <span className="text-stone-400">No close yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
