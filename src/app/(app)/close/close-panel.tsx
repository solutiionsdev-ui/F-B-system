"use client";

// Closing the day (v2.1 step 3): any difference needs a reason and a written
// explanation; then a confirmation summary shows exactly what will be frozen
// before the day is locked. The server checks every rule again.
import { startTransition, useActionState, useState } from "react";
import { closeDayAction } from "@/app/actions";
import { buttonClass, Field, inputClass, REASON_LABELS } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";

type PairText = { USD: string; LBP: string };

export function ClosePanel({
  dayId,
  hasSales,
  needsExplanation,
  willFlag,
  expected,
  counted,
  variance,
  varianceTone,
}: {
  dayId: string;
  hasSales: boolean;
  needsExplanation: boolean;
  /** True when a difference is over the allowance, so the day closes as Flagged. */
  willFlag: boolean;
  expected: PairText;
  counted: PairText;
  variance: PairText;
  varianceTone: { USD: "short" | "over" | "zero"; LBP: "short" | "over" | "zero" };
}) {
  const [state, action, pending] = useActionState(closeDayAction, initialActionState);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [noSales, setNoSales] = useState("");

  const tone = (t: "short" | "over" | "zero") => (t === "short" ? "text-red-700" : t === "over" ? "text-amber-700" : "text-emerald-700");

  if (step === "confirm") {
    return (
      <div className="space-y-3 rounded-xl border border-stone-300 bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-900">Check before closing</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right font-mono text-[10.5px] uppercase tracking-[0.06em] text-stone-400">
              <th />
              <th className="pb-1 font-medium">USD</th>
              <th className="pb-1 pl-3 font-medium">LBP</th>
            </tr>
          </thead>
          <tbody className="num">
            <tr>
              <td className="py-0.5 text-stone-600">Expected</td>
              <td className="text-right">{expected.USD}</td>
              <td className="pl-3 text-right">{expected.LBP}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-stone-600">Counted</td>
              <td className="text-right">{counted.USD}</td>
              <td className="pl-3 text-right">{counted.LBP}</td>
            </tr>
            <tr className="font-semibold">
              <td className="py-0.5 text-stone-700">Difference</td>
              <td className={`text-right ${tone(varianceTone.USD)}`}>{variance.USD}</td>
              <td className={`pl-3 text-right ${tone(varianceTone.LBP)}`}>{variance.LBP}</td>
            </tr>
          </tbody>
        </table>
        {needsExplanation && (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
            <span className="font-medium">{REASON_LABELS[reason]}:</span> “{note}”
          </p>
        )}
        {!hasSales && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No sales: “{noSales}”</p>}
        <p className="text-sm text-stone-700">
          The day closes as{" "}
          <span className={`font-semibold ${willFlag ? "text-red-700" : "text-emerald-700"}`}>{willFlag ? "Closed — Flagged" : "Closed — Balanced"}</span>.
          Closing locks every figure. Nothing can be edited or deleted afterwards; later fixes are added as corrections, with a name and a reason.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            className={buttonClass(willFlag ? "danger" : "primary")}
            onClick={() => {
              const fd = new FormData();
              fd.set("dayId", dayId);
              fd.set("reason", needsExplanation ? reason : "");
              fd.set("note", note);
              fd.set("noSalesReason", noSales);
              startTransition(() => action(fd));
            }}
          >
            {pending ? "Closing…" : "Confirm and close the day"}
          </button>
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => setStep("form")}>
            Back
          </button>
          {!pending && state.error && <span className="text-sm font-medium text-red-700">{state.error}</span>}
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        // Blank-looking text doesn't count as an explanation (the server refuses it too).
        if (needsExplanation && note.trim().length < 3) return;
        if (!hasSales && !noSales.trim()) return;
        setStep("confirm");
      }}
    >
      {!hasSales && (
        <Field label="No sales are recorded for this day. Why? (required)" hint="Or import the Omega file in step 1 first.">
          <input value={noSales} onChange={(e) => setNoSales(e.target.value)} required className={inputClass} placeholder="e.g. Closed for a public holiday" />
        </Field>
      )}
      {needsExplanation ? (
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="Reason for the difference (required)">
            <select value={reason} onChange={(e) => setReason(e.target.value)} required className={inputClass}>
              <option value="" disabled>
                Choose a reason…
              </option>
              {Object.entries(REASON_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Manager's explanation (required)" hint="What happened, in your own words. Kept with the closed day.">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} required minLength={3} className={inputClass} />
          </Field>
        </div>
      ) : (
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
      )}
      <button type="submit" className={`${buttonClass(willFlag ? "danger" : "primary")} w-full py-2.5 text-[15px] sm:w-auto`}>
        Close Day
      </button>
    </form>
  );
}
