"use client";

import { useState } from "react";
import { saveCountAction } from "@/app/actions";
import { DENOMINATIONS, formatAmount, parseOptionalAmount, type Currency } from "@/lib/money";
import { ActionForm } from "./action-form";
import { inputClass } from "./ui";

/** Count the drawer note by note; the total updates as you type. */
export function CountForm({
  dayId,
  currency,
  initialNotes,
  initialLoose,
}: {
  dayId: string;
  currency: Currency;
  initialNotes: Record<string, number>;
  initialLoose: string;
}) {
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(DENOMINATIONS[currency].map((n) => [String(n), initialNotes[String(n)] ? String(initialNotes[String(n)]) : ""])),
  );
  const [loose, setLoose] = useState(initialLoose);
  const factor = currency === "USD" ? 100n : 1n;

  let total: bigint | null = 0n;
  try {
    total = parseOptionalAmount(loose, currency);
    for (const [note, qty] of Object.entries(notes)) {
      if (qty.trim() === "") continue;
      if (!/^\d+$/.test(qty.trim())) throw new Error();
      total += BigInt(note) * factor * BigInt(qty.trim());
    }
  } catch {
    total = null;
  }

  return (
    <ActionForm action={saveCountAction} submitLabel={`Save ${currency} count`} variant="secondary" className="space-y-3">
      <input type="hidden" name="dayId" value={dayId} />
      <input type="hidden" name="currency" value={currency} />
      <div className="grid grid-cols-3 gap-2">
        {DENOMINATIONS[currency].map((n) => (
          <label key={n} className="block">
            <span className="mb-1 block text-[11px] font-medium text-stone-500 num">
              {currency === "USD" ? `$${n}` : `${n.toLocaleString("en-US")}`}
            </span>
            <input
              name={`note_${n}`}
              inputMode="numeric"
              placeholder="0"
              value={notes[String(n)]}
              onChange={(e) => setNotes({ ...notes, [String(n)]: e.target.value })}
              className={`${inputClass} num text-right`}
              aria-label={`Number of ${currency} ${n} notes`}
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-stone-500">
          {currency === "USD" ? "Coins / loose change ($)" : "Loose / other (LBP)"}
        </span>
        <input
          name="loose"
          inputMode="decimal"
          placeholder="0"
          value={loose}
          onChange={(e) => setLoose(e.target.value)}
          className={`${inputClass} num text-right`}
        />
      </label>
      <div className="flex items-baseline justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
        <span className="text-stone-600">Counted</span>
        <span className="num font-semibold text-stone-900">
          {total == null ? "Check the numbers" : formatAmount(total, currency)}
        </span>
      </div>
    </ActionForm>
  );
}
