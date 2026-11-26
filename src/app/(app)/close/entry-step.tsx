// Daily Close, step 2: operating expenses and cash movements, entered and
// listed separately. Expenses reduce the cash-view remainder; movements only
// change where cash sits (drawer, safe, bank, a partner) and are never
// counted as expenses.
import { deleteMovementAction, voidExpenseAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, inputClass, Money } from "@/components/ui";
import { MOVEMENT_LABELS, movementKindOf, PAID_FROM_LABELS } from "@/lib/expense-buckets";
import { CURRENCIES, formatAmount, toInputValue, zeroPair } from "@/lib/money";
import type { DayData, ExpenseTemplate } from "@/server/daily-close";
import { EntryModes, type TemplateOption } from "./entry-modes";

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function ExpensesList({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  const active = d.expenses.filter((e) => e.status === "active");
  const total = zeroPair();
  for (const e of active) total[e.currency] += e.amountMinor;
  const drawer = zeroPair();
  for (const e of active) if (e.paidFrom === "drawer") drawer[e.currency] += e.amountMinor;
  return (
    <section className="min-w-0 rounded-xl border border-stone-200">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-stone-900">Operating expenses</h3>
        <span className="text-xs text-stone-500">Reduce the cash-view remainder</span>
      </header>
      {d.expenses.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-500">None recorded.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {d.expenses.map((e) => {
            const voided = e.status === "voided";
            return (
              <li key={e.id} className={`flex items-start justify-between gap-3 px-4 py-2.5 ${voided ? "text-stone-400" : ""}`}>
                <div className="min-w-0">
                  <div className={`font-medium ${voided ? "line-through" : "text-stone-800"}`}>{e.description || e.categoryName}</div>
                  <div className="text-xs text-stone-500">
                    {[e.description ? e.categoryName : null, PAID_FROM_LABELS[e.paidFrom], e.vendor, e.receiptRef ? `Receipt ${e.receiptRef}` : null, e.createdByName ? `by ${e.createdByName}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {voided && (
                    <div className="mt-1">
                      <Badge tone="warn">Voided: {e.voidReason}</Badge>
                    </div>
                  )}
                </div>
                <Money minor={e.amountMinor} currency={e.currency} className={voided ? "line-through" : "font-medium"} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-1 border-t border-stone-100 bg-stone-50/60 px-4 py-2 text-xs text-stone-600">
        <div className="flex justify-between gap-3">
          <span>Total</span>
          <span className="num font-medium text-stone-900">
            {CURRENCIES.map((c) => formatAmount(total[c], c)).join(" · ")}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Paid from the drawer</span>
          <span className="num">{CURRENCIES.map((c) => formatAmount(drawer[c], c)).join(" · ")}</span>
        </div>
      </div>
      {canOperate && active.length > 0 && (
        <details className="border-t border-stone-100 px-4 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-stone-600">Void an expense entered by mistake</summary>
          <ActionForm action={voidExpenseAction} submitLabel="Void expense" variant="danger" resetOnSuccess className="mt-3 space-y-3">
            <input type="hidden" name="dayId" value={d.day.id} />
            <Field label="Expense">
              <select name="expenseId" className={inputClass}>
                {active.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.description || e.categoryName} ({formatAmount(e.amountMinor, e.currency)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason" hint="Kept in the audit trail. The entry stays listed, struck through.">
              <input name="reason" className={inputClass} required />
            </Field>
          </ActionForm>
        </details>
      )}
    </section>
  );
}

function MovementsList({ d, canRecord, canAdjustFloat }: { d: DayData; canRecord: boolean; canAdjustFloat: boolean }) {
  return (
    <section className="min-w-0 rounded-xl border border-stone-200">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-stone-900">Cash movements</h3>
        <span className="text-xs text-stone-500">Not expenses</span>
      </header>
      {d.movements.length === 0 ? (
        <p className="px-4 py-3 text-sm text-stone-500">None recorded.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {d.movements.map((m) => {
            const kind = movementKindOf(m);
            const canRemove = kind === "float_adjustment" ? canAdjustFloat : canRecord;
            return (
              <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-stone-800">
                    {MOVEMENT_LABELS[kind]}
                    {m.partnerName && <span className="font-normal text-stone-600"> · {m.partnerName}</span>}
                  </div>
                  <div className="text-xs text-stone-500">
                    {kind === "float_adjustment"
                      ? m.direction === "in"
                        ? "Added to the opening float"
                        : "Taken off the opening float"
                      : kind === "safe_drop"
                        ? `${m.currency} drawer → safe or bank`
                        : m.direction === "in"
                          ? "Put into the drawer"
                          : `${m.currency} drawer → out of the business`}
                    {m.reason && m.reason !== MOVEMENT_LABELS[kind] && <> · {m.reason}</>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Money minor={m.direction === "in" ? m.amountMinor : -m.amountMinor} currency={m.currency} signed className="font-medium" />
                  {canRemove && (
                    <ActionForm action={deleteMovementAction} submitLabel="Remove" variant="ghost" className="contents" pendingLabel="…" confirmText="Remove this cash movement? The removal is kept in the audit trail.">
                      <input type="hidden" name="dayId" value={d.day.id} />
                      <input type="hidden" name="movementId" value={m.id} />
                    </ActionForm>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-stone-100 bg-stone-50/60 px-4 py-2 text-xs text-stone-600">
        They change the cash expected in the drawer and where it sits, never the expenses.
      </p>
    </section>
  );
}

export function EntryStep({
  d,
  templates,
  canRecord,
  canAdjustFloat,
}: {
  d: DayData;
  templates: ExpenseTemplate[];
  canRecord: boolean;
  canAdjustFloat: boolean;
}) {
  const open = d.day.status === "open";
  const options: TemplateOption[] = templates.map((t) => ({
    key: t.key,
    categoryId: t.categoryId,
    categoryName: t.categoryName,
    description: t.description,
    vendor: t.vendor ?? "",
    currency: t.currency,
    paidFrom: t.paidFrom,
    amount: toInputValue(t.amountMinor, t.currency),
    amountLabel: formatAmount(t.amountMinor, t.currency),
    lastDate: shortDate(t.lastDate),
  }));
  const activeCount = d.expenses.filter((e) => e.status === "active").length;
  const counts = `${activeCount} expense${activeCount === 1 ? "" : "s"} · ${d.movements.length} movement${d.movements.length === 1 ? "" : "s"}`;
  return (
    <Card
      id="step-2"
      step={2}
      title="Log expenses & cash movements"
      description="Operating expenses and cash movements are entered and kept apart. Card and Bank / Whish payments never touch the drawer."
      actions={<Badge>{counts}</Badge>}
    >
      <div className="space-y-4">
        {open && (canRecord || canAdjustFloat) && (
          <EntryModes dayId={d.day.id} categories={d.categories} templates={canRecord ? options : []} canRecord={canRecord} canAdjustFloat={canAdjustFloat} />
        )}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ExpensesList d={d} canOperate={open && canRecord} />
          <MovementsList d={d} canRecord={open && canRecord} canAdjustFloat={open && canAdjustFloat} />
        </div>
      </div>
    </Card>
  );
}
