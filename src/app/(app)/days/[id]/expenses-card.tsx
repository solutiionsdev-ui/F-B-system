import { addExpenseAction, voidExpenseAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EntryGrid, ExpenseFields } from "@/components/entry-forms";
import { Badge, Card, Field, inputClass, Money } from "@/components/ui";
import { PAID_FROM_LABELS } from "@/lib/expense-buckets";
import { CURRENCIES, formatAmount, usdEquivalent, zeroPair } from "@/lib/money";
import type { DayData } from "./page";

export function ExpensesCard({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  const active = d.expenses.filter((e) => e.status === "active");
  const total = zeroPair();
  for (const e of active) total[e.currency] += e.amountMinor;

  return (
    <Card
      step={2}
      title="Expenses"
      description="Operating costs paid today. They reduce profit. Only the ones paid from the cash drawer change the expected cash."
    >
      {d.expenses.length === 0 ? (
        <p className="mb-4 text-sm text-stone-500">No expenses recorded yet.</p>
      ) : (
        <div className="-mx-5 mb-4 overflow-x-auto border-b border-stone-100">
          <table className="w-full text-sm">
            <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
              <tr>
                <th className="px-5 py-2">What</th>
                <th className="px-3 py-2">Paid with</th>
                <th className="px-5 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {d.expenses.map((e) => (
                <tr key={e.id} className={e.status === "voided" ? "text-stone-400" : ""}>
                  <td className="px-5 py-2.5">
                    <div className={`font-medium ${e.status === "voided" ? "line-through" : "text-stone-800"}`}>
                      {e.description || e.categoryName}
                    </div>
                    <div className="text-xs text-stone-500">
                      {[
                        e.description ? e.categoryName : null,
                        e.vendor,
                        e.receiptRef ? `Receipt ${e.receiptRef}` : null,
                        e.createdByName ? `by ${e.createdByName}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {e.status === "voided" && (
                      <div className="mt-1">
                        <Badge tone="warn">Voided: {e.voidReason}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{PAID_FROM_LABELS[e.paidFrom]}</td>
                  <td className="px-5 py-2.5 text-right">
                    <Money minor={e.amountMinor} currency={e.currency} className={e.status === "voided" ? "line-through" : ""} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-stone-50 text-sm">
                <td className="px-5 py-2 font-medium text-stone-700" colSpan={2}>
                  Total (active)
                </td>
                <td className="px-5 py-2 text-right font-medium">
                  {CURRENCIES.map((c) => (
                    <div key={c}>
                      <Money minor={total[c]} currency={c} />
                    </div>
                  ))}
                  <div className="text-xs font-normal text-stone-500">
                    ≈ <Money minor={usdEquivalent(total, d.rateScaled)} currency="USD" />
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canOperate && active.length > 0 && (
        <details className="mb-4 rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-stone-600">Void an expense entered by mistake</summary>
          <ActionForm action={voidExpenseAction} submitLabel="Void expense" variant="danger" resetOnSuccess className="mt-3 space-y-3">
            <input type="hidden" name="dayId" value={d.day.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Expense">
                <select name="expenseId" className={inputClass}>
                  {active.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.description || e.categoryName} ({formatAmount(e.amountMinor, e.currency)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reason" hint="Kept in the audit trail">
                <input name="reason" className={inputClass} required />
              </Field>
            </div>
          </ActionForm>
        </details>
      )}

      {canOperate && (
        <ActionForm action={addExpenseAction} submitLabel="Add expense" resetOnSuccess>
          <input type="hidden" name="dayId" value={d.day.id} />
          <EntryGrid>
            <ExpenseFields categories={d.categories} />
          </EntryGrid>
        </ActionForm>
      )}
    </Card>
  );
}
