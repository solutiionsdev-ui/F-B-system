import Link from "next/link";
import { addExpenseAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DayField, EntryGrid, ExpenseFields } from "@/components/entry-forms";
import { PeriodFilter, readPeriod, type PeriodSearch } from "@/components/period-filter";
import { Badge, buttonClass, Card, formatDate, Kpi, Money, PageTitle, PAID_FROM_LABELS } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEntryOptions } from "@/server/ledgers";
import { listLocations, todayIn, UserError } from "@/server/operations";
import { computePeriodReport, REPORT_ROLES, type PeriodReport } from "@/server/reports";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const today = todayIn();
  const db = await getDb();
  const role = ctx.active.role;
  const canOperate = role === "owner" || role === "manager";

  const entry = canOperate ? await getEntryOptions(db, ctx.scope) : null;
  let report: PeriodReport | null = null;
  let filterError: string | null = null;
  try {
    report = await computePeriodReport(db, ctx.scope, readPeriod(sp, today));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    filterError = e.message;
  }
  const locations = report?.locations ?? (await listLocations(db, ctx.scope)).map((l) => ({ id: l.id, name: l.name }));

  const csv =
    report && REPORT_ROLES.includes(role)
      ? `/reports/export?${new URLSearchParams({
          from: report.filter.from,
          to: report.filter.to,
          ...(report.filter.locationId ? { location: report.filter.locationId } : {}),
          format: "csv",
          kind: "expenses",
        })}`
      : null;

  return (
    <>
      <PageTitle
        title="Expenses"
        subtitle="Operating costs. They reduce profit. Safe drops, bank deposits and partner withdrawals are not expenses; they go under Cash."
        actions={
          csv && (
            <a href={csv} className={buttonClass("secondary")} download>
              Download CSV
            </a>
          )
        }
      />
      <PeriodFilter basePath="/expenses" filter={report?.filter ?? readPeriod({}, today)} locations={locations} today={today} />

      {filterError || !report ? (
        <Card>
          <p className="text-sm text-red-700">{filterError}</p>
        </Card>
      ) : (
        <Body report={report} entry={entry} />
      )}
    </>
  );
}

function Body({ report, entry }: { report: PeriodReport; entry: Awaited<ReturnType<typeof getEntryOptions>> | null }) {
  const t = report.totals;
  const active = report.expenses.filter((e) => e.status === "active");
  const paid = (m: string) => report.paidFrom.find((p) => p.paidFrom === m)?.eq ?? 0n;
  const top = report.categories[0];
  const multi = report.locations.length > 1 && !report.filter.locationId;
  const rows = [...report.expenses].reverse();

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Operating expenses"
          value={<Money minor={t.expensesEq} currency="USD" />}
          sub={`${active.length} entr${active.length === 1 ? "y" : "ies"} · ${report.categories.length} categor${report.categories.length === 1 ? "y" : "ies"}`}
        />
        <Kpi label="Paid from the cash drawer" value={<Money minor={paid("drawer")} currency="USD" />} sub="Lowers the cash expected in the drawer" />
        <Kpi label="Paid by Bank / Whish" value={<Money minor={paid("bank")} currency="USD" />} sub="Doesn't touch the drawer" />
        <Kpi
          label="Biggest category"
          value={top ? <Money minor={top.eq} currency="USD" /> : "—"}
          sub={top ? `${top.name} · ${t.expensesEq > 0n ? Number((top.eq * 100n) / t.expensesEq) : 0}% of the total` : "No expenses yet"}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="All expenses"
          description={`Newest first. ≈ USD at each expense's own rate.${t.voidedExpenses ? " Voided entries stay listed, struck through." : ""}`}
        >
          {rows.length === 0 ? (
            <p className="text-sm text-stone-500">No expenses in this period.</p>
          ) : (
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                  <tr>
                    <th className="px-5 py-2.5">Date</th>
                    <th className="px-3 py-2.5">What</th>
                    {multi && <th className="px-3 py-2.5">Location</th>}
                    <th className="px-3 py-2.5">Paid with</th>
                    <th className="px-5 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((e) => {
                    const voided = e.status === "voided";
                    const date = formatDate(e.date, { weekday: "short", day: "numeric", month: "short" });
                    return (
                      <tr key={e.id} className={`align-top ${voided ? "text-stone-400" : ""}`}>
                        <td className="whitespace-nowrap px-5 py-3">
                          {e.dayId ? (
                            <Link href={`/days/${e.dayId}`} className="font-medium text-stone-900 hover:underline">
                              {date}
                            </Link>
                          ) : (
                            date
                          )}
                        </td>
                        <td className="min-w-48 px-3 py-3">
                          <div className={`font-medium ${voided ? "line-through" : "text-stone-800"}`}>{e.description || e.category}</div>
                          <div className="text-xs text-stone-500">
                            {[e.description ? e.category : null, e.vendor, e.receiptRef ? `Receipt ${e.receiptRef}` : null, e.enteredBy ? `by ${e.enteredBy}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          {voided && (
                            <div className="mt-1">
                              <Badge tone="warn">Voided: {e.voidReason}</Badge>
                            </div>
                          )}
                        </td>
                        {multi && <td className="px-3 py-3 text-stone-600">{e.locationName}</td>}
                        <td className="whitespace-nowrap px-3 py-3 text-stone-600">{PAID_FROM_LABELS[e.paidFrom]}</td>
                        <td className="px-5 py-3 text-right">
                          <Money minor={e.amountMinor} currency={e.currency} className={voided ? "line-through" : "font-medium"} />
                          {e.currency === "LBP" && (
                            <div className="text-xs text-stone-500">
                              ≈ <Money minor={e.eq} currency="USD" />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          {entry && (
            <Card title="Add an expense" description="Entered on an open business day. Only cash-drawer payments change the cash expected at closing.">
              {entry.openDays.length === 0 ? (
                <p className="text-sm text-stone-600">
                  No business day is open.{" "}
                  <Link href="/closing" className="font-medium text-brand-700 underline">
                    Open one from Cash Closing
                  </Link>{" "}
                  to record expenses.
                </p>
              ) : (
                <ActionForm action={addExpenseAction} submitLabel="Add expense" resetOnSuccess>
                  <EntryGrid>
                    <DayField days={entry.openDays} />
                    <ExpenseFields categories={entry.categories} />
                  </EntryGrid>
                </ActionForm>
              )}
            </Card>
          )}

          <Card title="By category">
            {report.categories.length === 0 ? (
              <p className="text-sm text-stone-500">No expenses in this period.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {report.categories.map((cat) => {
                  const share = t.expensesEq > 0n ? Number((cat.eq * 1000n) / t.expensesEq) / 10 : 0;
                  return (
                    <li key={cat.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-stone-800">
                          {cat.name} <span className="text-xs text-stone-400">× {cat.count}</span>
                        </span>
                        <Money minor={cat.eq} currency="USD" className="font-medium" />
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-stone-100">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.max(share, 1)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
