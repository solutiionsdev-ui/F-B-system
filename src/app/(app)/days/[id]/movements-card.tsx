import { addMovementAction, deleteMovementAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, Money } from "@/components/ui";
import type { DayData } from "./page";

export function MovementsCard({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  if (!canOperate && d.movements.length === 0) return null;
  return (
    <Card title="Cash in and out" description="Safe drops, change top-ups and owner withdrawals. These aren't sales or expenses.">
      {d.movements.length > 0 && (
        <ul className="-mx-5 mb-4 divide-y divide-stone-100 border-y border-stone-100 text-sm">
          {d.movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div>
                <div className="font-medium text-stone-800">{m.reason}</div>
                <div className="text-xs text-stone-500">{m.direction === "in" ? "Put into the drawer" : "Taken out of the drawer"}</div>
              </div>
              <div className="flex items-center gap-4">
                <Money minor={m.direction === "in" ? m.amountMinor : -m.amountMinor} currency={m.currency} signed />
                {canOperate && (
                  <ActionForm action={deleteMovementAction} submitLabel="Remove" variant="ghost" className="contents" pendingLabel="…">
                    <input type="hidden" name="dayId" value={d.day.id} />
                    <input type="hidden" name="movementId" value={m.id} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canOperate && (
        <ActionForm action={addMovementAction} submitLabel="Record movement" variant="secondary" resetOnSuccess>
          <input type="hidden" name="dayId" value={d.day.id} />
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Direction" className="sm:col-span-2">
              <select name="direction" defaultValue="out" className={inputClass}>
                <option value="out">Taken out</option>
                <option value="in">Put in</option>
              </select>
            </Field>
            <Field label="Amount" className="sm:col-span-2">
              <input name="amount" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} required />
            </Field>
            <Field label="Currency" className="sm:col-span-2">
              <select name="currency" defaultValue="USD" className={inputClass}>
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </Field>
            <Field label="Reason" className="sm:col-span-6">
              <input name="reason" placeholder="e.g. Safe drop" className={inputClass} required />
            </Field>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}
