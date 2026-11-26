"use client";

// The fields for a cash movement (bucket B). The type decides what else is
// asked: a partner withdrawal needs the partner's name, an opening float
// adjustment needs a direction and a reason. Each type says where the cash
// goes from and to. Movements change where cash sits and are never
// operating expenses.
import { useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/money";
import { OFFERED_MOVEMENT_KINDS, type MovementKind } from "@/lib/expense-buckets";
import { Field, inputClass } from "./ui";

/** From and to, in words, for the line under the type. */
function route(kind: MovementKind, currency: Currency, direction: "in" | "out") {
  const drawer = `${currency} cash drawer`;
  if (kind === "safe_drop") return `From the ${drawer} to the ${currency} safe or the bank`;
  if (kind === "partner_withdrawal") return `From the ${drawer} to a partner, out of the business`;
  return direction === "in" ? `Adds to the opening float of the ${drawer}` : `Reduces the opening float of the ${drawer}`;
}

export function MovementFields({ canRecord = true, canAdjustFloat = true }: { canRecord?: boolean; canAdjustFloat?: boolean }) {
  // Float adjustments belong to whoever runs the drawer; the other types to whoever records transactions.
  const kinds = OFFERED_MOVEMENT_KINDS.filter((k) => (k.kind === "float_adjustment" ? canAdjustFloat : canRecord));
  const first = kinds[0].kind;
  const [kind, setKind] = useState<MovementKind>(first);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const anchor = useRef<HTMLSelectElement>(null);

  // The surrounding form resets itself after a save; follow it back to the defaults.
  useEffect(() => {
    const form = anchor.current?.form;
    if (!form) return;
    const onReset = () => {
      setKind(first);
      setCurrency("USD");
      setDirection("in");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [first]);

  const current = kinds.find((k) => k.kind === kind) ?? kinds[0];
  return (
    <>
      <Field label="Type" className="col-span-6" hint={current.hint}>
        <select
          ref={anchor}
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as MovementKind)}
          className={inputClass}
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {kind === "partner_withdrawal" && (
        <Field label="Partner name" className="col-span-6">
          <input name="partnerName" maxLength={80} placeholder="Who took the cash" className={inputClass} required />
        </Field>
      )}
      {kind === "float_adjustment" && (
        <Field label="Adjustment" className="col-span-6">
          <select name="direction" value={direction} onChange={(e) => setDirection(e.target.value === "out" ? "out" : "in")} className={inputClass}>
            <option value="in">Add to the opening float</option>
            <option value="out">Reduce the opening float</option>
          </select>
        </Field>
      )}
      <Field label="Amount" className="col-span-4 @lg:col-span-3">
        <input name="amount" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} required />
      </Field>
      <Field label="Currency" className="col-span-2 @lg:col-span-3">
        <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value === "LBP" ? "LBP" : "USD")} className={inputClass}>
          <option value="USD">USD</option>
          <option value="LBP">LBP</option>
        </select>
      </Field>
      <p className="col-span-6 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-[13px] text-stone-700" aria-live="polite">
        <span aria-hidden className="text-stone-400">
          ⇄
        </span>
        {route(kind, currency, direction)}. Not an operating expense.
      </p>
      {kind === "float_adjustment" ? (
        <Field label="Reason" hint="Why the opening float is being corrected. The original float is kept." className="col-span-6">
          <input name="reason" placeholder="e.g. Float recounted before service" className={inputClass} required />
        </Field>
      ) : (
        <Field label="Note (optional)" className="col-span-6">
          <input name="reason" placeholder={kind === "safe_drop" ? "e.g. Deposited at the bank" : "e.g. Monthly drawing"} className={inputClass} />
        </Field>
      )}
    </>
  );
}
