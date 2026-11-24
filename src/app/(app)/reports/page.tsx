import Link from "next/link";
import {
  Badge,
  buttonClass,
  Card,
  Field,
  formatDate,
  inputClass,
  Money,
  PageTitle,
  PAID_FROM_LABELS,
  REASON_LABELS,
} from "@/components/ui";
import { formatRate, type Pair } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { todayIn, UserError } from "@/server/operations";
import { getComparison, getPeriodReport, REPORT_ROLES, shiftDate, type PeriodReport } from "@/server/reports";

type Search = { from?: string; to?: string; location?: string };

function presets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastEnd = shiftDate(monthStart, -1);
  return [
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastEnd.slice(0, 8)}01`, to: lastEnd },
    { label: "Last 7 days", from: shiftDate(today, -6), to: today },
    { label: "Last 30 days", from: shiftDate(today, -29), to: today },
  ];
}

function change(cur: bigint, prev: bigint | undefined) {
  if (prev == null || prev === 0n) return null;
  const p = (Number(cur - prev) / Math.abs(Number(prev))) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}% vs previous`;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!REPORT_ROLES.includes(ctx.active.role)) {
    return (
      <>
        <PageTitle title="Reports" />
        <Card>
          <p className="text-sm text-stone-600">Reports are available to owners and accountants.</p>
        </Card>
      </>
    );
  }

  const sp = await searchParams;
  const today = todayIn();
  const filter = { from: sp.from || `${today.slice(0, 8)}01`, to: sp.to || today, locationId: sp.location || null };
  const db = await getDb();
  let report: PeriodReport;
  let comparison: Awaited<ReturnType<typeof getComparison>> | null;
  try {
    report = await getPeriodReport(db, ctx.scope, filter);
    comparison = await getComparison(db, ctx.scope, filter);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return (
      <>
        <PageTitle title="Reports" />
        <Card>
          <p className="text-sm text-red-700">{e.message}</p>
          <Link href="/reports" className={`${buttonClass("secondary")} mt-3`}>
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
      <PageTitle
        title="Reports"
        subtitle={
          <>
            {formatDate(report.filter.from)} to {formatDate(report.filter.to)} · {report.location?.name ?? "All locations"}
            {report.rates.min != null && (
              <>
                {" "}
                · rate {formatRate(report.rates.min)}
                {report.rates.max !== report.rates.min && <>–{formatRate(report.rates.max!)}</>} LBP/$
              </>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={exportUrl({ format: "pdf" })} className={buttonClass("primary")} download>
              Download PDF
            </a>
            <a href={exportUrl({ format: "csv", kind: "daily" })} className={buttonClass("secondary")} download>
              Daily CSV
            </a>
            <a href={exportUrl({ format: "csv", kind: "expenses" })} className={buttonClass("secondary")} download>
              Expenses CSV
            </a>
          </div>
        }
      />

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
        <Field label="From">
          <input type="date" name="from" defaultValue={report.filter.from} className={inputClass} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={report.filter.to} className={inputClass} />
        </Field>
        {report.locations.length > 1 && (
          <Field label="Location">
            <select name="location" defaultValue={report.filter.locationId ?? ""} className={inputClass}>
              <option value="">All locations</option>
              {report.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className={buttonClass("secondary")}>Show</button>
        <div className="flex flex-wrap gap-1 text-sm sm:ml-auto">
          {presets(today).map((p) => {
            const pq = new URLSearchParams({ from: p.from, to: p.to });
            if (report.filter.locationId) pq.set("location", report.filter.locationId);
            const active = p.from === report.filter.from && p.to === report.filter.to;
            return (
              <Link
                key={p.label}
                href={`/reports?${pq}`}
                className={`rounded-md px-2.5 py-1.5 ${active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </form>

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

      <div className="mb-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Collected" value={<Money minor={t.salesEq.collected} currency="USD" />} sub={change(t.salesEq.collected, comparison?.collectedEq)} />
        <Kpi label="Recorded expenses" value={<Money minor={t.expensesEq} currency="USD" />} sub={change(t.expensesEq, comparison?.expensesEq)} />
        <Kpi
          label="Collected − expenses"
          value={<Money minor={t.cashResultEq} currency="USD" />}
          sub={change(t.cashResultEq, comparison?.cashResultEq)}
        />
        <Kpi
          label="Cash difference"
          value={<Money minor={c.netAfterAdjustmentsEq} currency="USD" signed variance />}
          sub={`${c.flaggedDays} flagged of ${c.closedDays} closed days`}
        />
      </div>
      <p className="mb-8 text-xs text-stone-500">
        <span className="font-medium text-stone-700">Net profit is withheld</span> until unit costs are verified (recipe costing comes
        later). &ldquo;Collected − expenses&rdquo; is a cash view that includes VAT collected; it isn&apos;t profit. All $ figures use
        each day&apos;s own exchange rate.
      </p>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <SalesCard r={report} />
        <ExpensesCard r={report} />
      </div>

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
        <Card title="Cash control" description={`A day is flagged when expected and counted cash differ by more than $${(Number(report.org.toleranceCents) / 100).toFixed(2)}.`}>
          <dl className="space-y-1.5 text-sm">
            <Row label="Closed and locked" value={`${c.closedDays} of ${c.days} days`} />
            <Row label="Balanced" value={String(c.balancedDays)} />
            <Row label="Flagged" value={<span className={c.flaggedDays ? "font-medium text-red-700" : ""}>{c.flaggedDays}</span>} />
            <Row label="Shortages" value={<Money minor={c.shortEq} currency="USD" signed variance />} />
            <Row label="Overages" value={<Money minor={c.overEq} currency="USD" signed variance />} />
            <Row label="Corrections after closing" value={<Money minor={c.adjustmentsEq} currency="USD" signed />} />
            <div className="border-t border-stone-200 pt-1.5">
              <Row
                label={<span className="font-semibold text-stone-900">Net difference after corrections</span>}
                value={<Money minor={c.netAfterAdjustmentsEq} currency="USD" signed variance className="font-semibold" />}
              />
            </div>
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
        {report.byLocation.length > 1 ? (
          <Card title="By location">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="px-5 py-2">Location</th>
                    <th className="px-3 py-2 text-right">Collected</th>
                    <th className="px-3 py-2 text-right">Expenses</th>
                    <th className="px-5 py-2 text-right">Cash diff.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {report.byLocation.map((l) => (
                    <tr key={l.locationId}>
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-stone-800">{l.name}</div>
                        <div className="text-xs text-stone-500">
                          {l.closedDays}/{l.days} days closed{l.flaggedDays ? ` · ${l.flaggedDays} flagged` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Money minor={l.collectedEq} currency="USD" />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Money minor={l.expensesEq} currency="USD" />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Money minor={l.varianceAfterEq} currency="USD" signed variance />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <div />
        )}
      </div>

      <Card title="Daily detail" description="Difference is shown after any corrections. Click a day to open it.">
        {report.daily.length === 0 ? (
          <p className="text-sm text-stone-500">No business days in this period.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
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
                      {d.varianceAfterEq == null ? <span className="text-stone-400">—</span> : <Money minor={d.varianceAfterEq} currency="USD" signed variance />}
                    </td>
                    <td className="px-5 py-2.5">
                      {!d.closing ? (
                        <Badge tone="info">Open</Badge>
                      ) : d.closing.withinTolerance ? (
                        <Badge tone="good">Balanced</Badge>
                      ) : (
                        <Badge tone="bad">{d.closing.reason ? REASON_LABELS[d.closing.reason] : "Flagged"}</Badge>
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

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string | null }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-stone-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-stone-500">{sub}</div>}
    </div>
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
            <tr className="text-right text-xs font-medium uppercase tracking-wide text-stone-500">
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
                  {row.memo && <span className="ml-1 text-[10px] uppercase tracking-wide text-stone-400">memo</span>}
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
      title="Expenses by category"
      description={`Active expenses${r.totals.voidedExpenses ? ` (${r.totals.voidedExpenses} voided left out)` : ""}, converted at each expense's own rate.`}
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
                  <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.max(share, 1)}%` }} />
                </div>
              </li>
            );
          })}
          <li className="flex items-baseline justify-between border-t border-stone-200 pt-2 font-semibold text-stone-900">
            <span>Total</span>
            <Money minor={total} currency="USD" />
          </li>
          <li className="text-xs text-stone-500">
            Paid from:{" "}
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
