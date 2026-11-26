import Link from "next/link";
import { addMovementAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DayField, EntryGrid, MovementFields } from "@/components/entry-forms";
import { PeriodFilter, readPeriod, type PeriodSearch } from "@/components/period-filter";
import { Card, formatDate, Kpi, Money, PageTitle } from "@/components/ui";
import { MOVEMENT_KINDS, MOVEMENT_LABELS } from "@/lib/expense-buckets";
import { formatAmount, zeroPair } from "@/lib/money";
import { branchLabel, requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEntryOptions, listMovements, type MovementRow } from "@/server/ledgers";
import { todayIn, UserError } from "@/server/operations";
import { validateFilter } from "@/server/reports";

export default async function CashPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const today = todayIn();
  const db = await getDb();
  const canOperate = ctx.can("record_transactions");
  const branchId = ctx.branch?.id ?? null;

  const entry = canOperate ? await getEntryOptions(db, ctx.scope, branchId) : null;
  let filter = readPeriod(sp, today, branchId);
  let rows: MovementRow[] | null = null;
  let filterError: string | null = null;
  try {
    filter = validateFilter(filter);
    rows = await listMovements(db, ctx.scope, filter);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    filterError = e.message;
  }
  const multi = ctx.branches.length > 1 && !filter.locationId;

  return (
    <>
      <PageTitle
        title="Cash"
        subtitle="Cash that changes place without being a cost: safe drops and bank deposits, partner withdrawals, cash added to the drawer. They change the cash in the drawer but never count as expenses or profit."
      />
      <PeriodFilter basePath="/cash" filter={filter} branchLabel={branchLabel(ctx)} today={today} />

      {filterError || !rows ? (
        <Card>
          <p className="text-sm text-red-700">{filterError}</p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {MOVEMENT_KINDS.map((k) => {
              const mine = rows.filter((r) => r.kind === k.kind);
              const pair = zeroPair();
              let eq = 0n;
              for (const r of mine) {
                pair[r.currency] += r.amountMinor;
                eq += r.eq;
              }
              const parts = (["USD", "LBP"] as const).filter((c) => pair[c] !== 0n).map((c) => formatAmount(pair[c], c));
              return (
                <Kpi
                  key={k.kind}
                  label={k.label}
                  value={<Money minor={eq} currency="USD" className={mine.length === 0 ? "text-stone-300" : ""} />}
                  sub={mine.length === 0 ? k.hint : `${mine.length} entr${mine.length === 1 ? "y" : "ies"} · ${parts.join(" + ")}`}
                />
              );
            })}
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Card title="All movements" description="Newest first. ≈ USD at each day's own rate.">
              {rows.length === 0 ? (
                <p className="text-sm text-stone-500">No safe drops, deposits or withdrawals in this period.</p>
              ) : (
                <div className="-mx-5 -my-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                      <tr>
                        <th className="px-5 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Type</th>
                        {multi && <th className="px-3 py-2.5">Location</th>}
                        <th className="px-5 py-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {rows.map((m) => (
                        <tr key={m.id} className="align-top">
                          <td className="whitespace-nowrap px-5 py-3">
                            <Link href={`/days/${m.dayId}`} className="font-medium text-stone-900 hover:underline">
                              {formatDate(m.date, { weekday: "short", day: "numeric", month: "short" })}
                            </Link>
                          </td>
                          <td className="min-w-48 px-3 py-3">
                            <div className="font-medium text-stone-800">{MOVEMENT_LABELS[m.kind]}</div>
                            <div className="text-xs text-stone-500">
                              {[
                                m.direction === "in" ? "Put into the drawer" : "Taken out of the drawer",
                                m.reason && m.reason !== MOVEMENT_LABELS[m.kind] ? m.reason : null,
                                m.enteredBy ? `by ${m.enteredBy}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </td>
                          {multi && <td className="px-3 py-3 text-stone-600">{m.locationName}</td>}
                          <td className="px-5 py-3 text-right">
                            <Money minor={m.direction === "in" ? m.amountMinor : -m.amountMinor} currency={m.currency} signed className="font-medium" />
                            {m.currency === "LBP" && (
                              <div className="text-xs text-stone-500">
                                ≈ <Money minor={m.eq} currency="USD" />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {entry && (
              <Card title="Record a movement" description="Entered on an open business day. It changes the cash expected at closing.">
                {entry.openDays.length === 0 ? (
                  <p className="text-sm text-stone-600">
                    No business day is open.{" "}
                    <Link href="/closing" className="font-medium text-brand-700 underline">
                      Open one from Cash Closing
                    </Link>{" "}
                    to record cash movements.
                  </p>
                ) : (
                  <ActionForm action={addMovementAction} submitLabel="Record movement" resetOnSuccess>
                    <EntryGrid>
                      <DayField days={entry.openDays} />
                      <MovementFields />
                    </EntryGrid>
                  </ActionForm>
                )}
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
