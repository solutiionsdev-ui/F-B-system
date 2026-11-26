// The "Cash movements" tab of Expenses & Movements: cash that changes place
// without being a cost (bucket B). Kept apart from expenses on purpose.
import Link from "next/link";
import { Card, formatDate, Kpi, Money } from "@/components/ui";
import { MOVEMENT_KINDS, MOVEMENT_LABELS } from "@/lib/expense-buckets";
import { formatAmount, zeroPair } from "@/lib/money";
import type { MovementRow } from "@/server/ledgers";

export function MovementsView({ rows, multi }: { rows: MovementRow[]; multi: boolean }) {
  return (
    <>
      <p className="mb-4 rounded-lg bg-stone-100/70 px-3 py-2 text-[13px] text-stone-600">
        Cash movements adjust account balances but are not operating expenses.
      </p>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MOVEMENT_KINDS.filter((k) => k.offered || rows.some((r) => r.kind === k.kind)).map((k) => {
          const mine = rows.filter((r) => r.kind === k.kind);
          const pair = zeroPair();
          let eq = 0n;
          for (const r of mine) {
            // A float adjustment can add or reduce, so its total is signed.
            const sign = k.kind === "float_adjustment" && r.direction === "out" ? -1n : 1n;
            pair[r.currency] += sign * r.amountMinor;
            eq += sign * r.eq;
          }
          const parts = (["USD", "LBP"] as const)
            .filter((c) => pair[c] !== 0n)
            .map((c) => formatAmount(pair[c], c, { signed: k.kind === "float_adjustment" }));
          return (
            <Kpi
              key={k.kind}
              label={k.label}
              value={<Money minor={eq} currency="USD" signed={k.kind === "float_adjustment"} className={mine.length === 0 ? "text-stone-300" : ""} />}
              sub={mine.length === 0 ? k.hint : `${mine.length} entr${mine.length === 1 ? "y" : "ies"} · ${parts.join(" and ") || "nets to zero"}`}
            />
          );
        })}
      </div>

      <div>
        <Card title="All movements" description="Newest first. Original currency and amount; ≈ USD at the rate locked on each movement's business day.">
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
                        <div className="font-medium text-stone-800">
                          {MOVEMENT_LABELS[m.kind]}
                          {m.partnerName && <span className="font-normal text-stone-600"> · {m.partnerName}</span>}
                        </div>
                        <div className="text-xs text-stone-500">
                          {[
                            m.kind === "float_adjustment"
                              ? m.direction === "in"
                                ? "Added to the opening float"
                                : "Taken off the opening float"
                              : m.direction === "in"
                                ? "Put into the drawer"
                                : "Taken out of the drawer",
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

      </div>
    </>
  );
}
