// The fields for entering an expense or a cash movement. Used on a day's page
// (the day is fixed) and on the Expenses and Cash pages (pick an open day).
import type { ReactNode } from "react";
import { CATEGORY_HINTS, MOVEMENT_KINDS, PAID_FROM_LABELS, PAYMENT_METHODS } from "@/lib/expense-buckets";
import { Field, formatDate, inputClass, labelClass } from "./ui";

/** Lays the fields out by the width of the card they sit in, not the window: a side column gets the narrow layout. */
export function EntryGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-6 gap-3">{children}</div>
    </div>
  );
}

const dayLabel = (d: { date: string; locationName: string }) =>
  `${d.locationName} · ${formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}`;

/** Which open business day the entry goes on: stated when there's one, a picker when there are several. */
export function DayField({ days }: { days: { id: string; date: string; locationName: string }[] }) {
  if (days.length === 1) {
    return (
      <p className="col-span-6 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
        <input type="hidden" name="dayId" value={days[0].id} />
        Goes on <span className="font-medium text-stone-900">{dayLabel(days[0])}</span>
      </p>
    );
  }
  return (
    <Field label="Business day" className="col-span-6">
      <select name="dayId" className={inputClass} required>
        {days.map((d) => (
          <option key={d.id} value={d.id}>
            {dayLabel(d)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ExpenseFields({ categories }: { categories: { id: string; name: string }[] }) {
  const hints = categories.filter((c) => CATEGORY_HINTS[c.name]).map((c) => `${c.name}: ${CATEGORY_HINTS[c.name]}`);
  return (
    <>
      <Field label="Category" className="col-span-6" hint={hints.join(" ") || undefined}>
        <select name="categoryId" className={inputClass} required>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount" className="col-span-4 @lg:col-span-2">
        <input name="amount" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} required />
      </Field>
      <Field label="Currency" className="col-span-2 @lg:col-span-1">
        <select name="currency" defaultValue="LBP" className={inputClass}>
          <option value="LBP">LBP</option>
          <option value="USD">USD</option>
        </select>
      </Field>
      <fieldset className="col-span-6 @lg:col-span-3">
        <legend className={labelClass}>Paid with</legend>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:font-medium has-[:checked]:text-stone-900 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-500/15"
            >
              <input type="radio" name="paidFrom" value={m} defaultChecked={m === "drawer"} className="sr-only" />
              {PAID_FROM_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Supplier (optional)" className="col-span-3">
        <input name="vendor" className={inputClass} />
      </Field>
      <Field label="Receipt no. (optional)" className="col-span-3">
        <input name="receiptRef" className={inputClass} />
      </Field>
      <Field label="Notes (optional)" className="col-span-6">
        <input name="description" placeholder="e.g. Bread delivery, Saturday shift" className={inputClass} />
      </Field>
    </>
  );
}

export function MovementFields() {
  return (
    <>
      <Field label="Type" className="col-span-6">
        <select name="kind" defaultValue="safe_drop" className={inputClass}>
          {MOVEMENT_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount" className="col-span-4 @lg:col-span-3">
        <input name="amount" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} required />
      </Field>
      <Field label="Currency" className="col-span-2 @lg:col-span-3">
        <select name="currency" defaultValue="USD" className={inputClass}>
          <option value="USD">USD</option>
          <option value="LBP">LBP</option>
        </select>
      </Field>
      <Field label="Note" hint="Which partner, which bank, or why. Needed for “Other cash taken out”." className="col-span-6">
        <input name="reason" placeholder="e.g. Deposited at the bank" className={inputClass} />
      </Field>
    </>
  );
}
