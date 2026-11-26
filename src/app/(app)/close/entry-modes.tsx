"use client";

// Step 2's quick entry: two modes that never mix. An operating expense
// reduces the cash-view remainder; a cash movement only changes where cash
// sits. Recent expenses can prefill the expense form, but a person always
// checks it and presses save; nothing is posted from a template on its own.
import { useEffect, useRef, useState } from "react";
import { addExpenseAction, addMovementAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { EntryGrid, ExpenseFields } from "@/components/entry-forms";
import { MovementFields } from "@/components/movement-fields";

export type TemplateOption = {
  key: string;
  categoryId: string;
  categoryName: string;
  description: string;
  vendor: string;
  currency: "USD" | "LBP";
  paidFrom: string;
  /** As typed in the amount field ("45" or "1,200,000"). */
  amount: string;
  amountLabel: string;
  lastDate: string;
};

function setValue(form: HTMLFormElement, name: string, value: string) {
  const el = form.elements.namedItem(name);
  if (!el) return;
  if (el instanceof RadioNodeList) {
    for (const node of Array.from(el)) if (node instanceof HTMLInputElement) node.checked = node.value === value;
    return;
  }
  (el as HTMLInputElement | HTMLSelectElement).value = value;
}

function ExpenseForm({
  dayId,
  categories,
  templates,
}: {
  dayId: string;
  categories: { id: string; name: string }[];
  templates: TemplateOption[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState<TemplateOption | null>(null);

  // After a save (the form resets itself) or a manual clear, drop the "filled from" notice.
  useEffect(() => {
    const form = wrap.current?.querySelector("form");
    if (!form) return;
    const onReset = () => setFilled(null);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const apply = (t: TemplateOption) => {
    const form = wrap.current?.querySelector("form");
    if (!form) return;
    setValue(form, "categoryId", t.categoryId);
    setValue(form, "currency", t.currency);
    setValue(form, "paidFrom", t.paidFrom);
    setValue(form, "vendor", t.vendor);
    setValue(form, "description", t.description);
    setValue(form, "amount", t.amount);
    setFilled(t);
    const amount = form.elements.namedItem("amount") as HTMLInputElement | null;
    amount?.focus();
    amount?.select();
  };

  return (
    <div ref={wrap} className="space-y-3">
      {templates.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-stone-500">Recent at this branch: tap one to fill the form, then check it and save</div>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => apply(t)}
                className={`max-w-full truncate rounded-full border px-2.5 py-1 text-xs ${
                  filled?.key === t.key ? "border-brand-600 bg-brand-50 text-stone-900" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                }`}
                title={`${t.categoryName} · ${t.description} · ${t.amountLabel} · last ${t.lastDate}`}
              >
                {t.description} <span className="num text-stone-400">· {t.amountLabel}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {filled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900" role="status">
          <span>
            Filled from <span className="font-medium">{filled.description}</span> ({filled.lastDate}). Check the amount and note: nothing is saved
            until you press Add expense.
          </span>
          <button
            type="button"
            className="text-xs font-medium underline"
            onClick={() => wrap.current?.querySelector("form")?.reset()}
          >
            Clear
          </button>
        </div>
      )}
      <ActionForm action={addExpenseAction} submitLabel="Add expense" resetOnSuccess>
        <input type="hidden" name="dayId" value={dayId} />
        <EntryGrid>
          <ExpenseFields categories={categories} />
        </EntryGrid>
      </ActionForm>
    </div>
  );
}

export function EntryModes({
  dayId,
  categories,
  templates,
  canRecord,
  canAdjustFloat,
}: {
  dayId: string;
  categories: { id: string; name: string }[];
  templates: TemplateOption[];
  canRecord: boolean;
  canAdjustFloat: boolean;
}) {
  const [mode, setMode] = useState<"expense" | "movement">(canRecord ? "expense" : "movement");
  const modes = [
    ...(canRecord ? [{ key: "expense" as const, label: "Operating expense", hint: "Reduces the cash-view remainder" }] : []),
    { key: "movement" as const, label: "Cash movement", hint: "Moves cash. Never an expense" },
  ];
  return (
    <div className="rounded-xl border border-stone-200 p-3 sm:p-4">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1" role="tablist" aria-label="What are you recording?">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
            className={`rounded-md px-2 py-1.5 text-left text-sm sm:px-3 ${
              mode === m.key ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)]" : "text-stone-600 hover:text-stone-900"
            }`}
          >
            <span className="block truncate">{m.label}</span>
            <span className="block truncate text-[11px] font-normal text-stone-500">{m.hint}</span>
          </button>
        ))}
      </div>
      {mode === "expense" && canRecord ? (
        <ExpenseForm dayId={dayId} categories={categories} templates={templates} />
      ) : (
        <ActionForm action={addMovementAction} submitLabel="Record movement" resetOnSuccess>
          <input type="hidden" name="dayId" value={dayId} />
          <EntryGrid>
            <MovementFields canRecord={canRecord} canAdjustFloat={canAdjustFloat} />
          </EntryGrid>
        </ActionForm>
      )}
    </div>
  );
}
