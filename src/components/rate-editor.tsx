"use client";

// Safe rate editing (spec 7.3, v2.1 rate badge): the field starts at the
// active rate (never an older one), a source must be chosen, saving takes a
// separate confirmation, and Cancel changes nothing. A new rate applies to
// business days opened from then on; open and closed days keep theirs.
import { startTransition, useActionState, useEffect, useState } from "react";
import { setRateAction } from "@/app/actions";
import { initialActionState } from "@/lib/action-state";
import { useToast } from "./toast";
import { buttonClass, inputClass, labelClass } from "./ui";

type Source = "market" | "bank" | "custom";
const SOURCES: { value: Source; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "bank", label: "Bank" },
  { value: "custom", label: "Other" },
];

/** `currentText` is the active rate as shown ("89,700"), or null before the first rate. `onDone` closes whatever holds the editor. */
export function RateEditor({ currentText, onDone }: { currentText: string | null; onDone: () => void }) {
  const [state, action, pending] = useActionState(setRateAction, initialActionState);
  const [step, setStep] = useState<"editing" | "confirming">("editing");
  const [rate, setRate] = useState(currentText ?? "");
  const [source, setSource] = useState<Source | "">("");
  const [note, setNote] = useState("");
  const toast = useToast();

  // A save that went through closes the editor; the page reloads with the new rate.
  useEffect(() => {
    if (!state.at || !state.ok) return;
    if (toast) toast({ title: state.ok });
    onDone();
  }, [state.at, state.ok, toast, onDone]);

  const digits = rate.replace(/[\s,]/g, "");
  const valid = /^\d+(\.\d{1,4})?$/.test(digits) && Number(digits) > 0;
  const unchanged = currentText != null && digits === currentText.replace(/,/g, "");
  const ready = valid && !unchanged && source !== "";

  if (step === "confirming") {
    return (
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-medium">
          {currentText ? (
            <>
              Change the rate from <span className="num">{currentText}</span> to <span className="num">{rate}</span> LBP per 1 USD?
            </>
          ) : (
            <>
              Set the rate to <span className="num">{rate}</span> LBP per 1 USD?
            </>
          )}
        </p>
        <p className="text-[13px]">
          Source: {SOURCES.find((s) => s.value === source)?.label}
          {note && <> · “{note}”</>}. It applies to business days opened from now on. Days already open or closed keep the rate they
          have, so past figures never change.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            className={buttonClass("primary")}
            onClick={() => {
              const fd = new FormData();
              fd.set("rate", rate);
              fd.set("source", source);
              fd.set("note", note);
              startTransition(() => action(fd));
            }}
          >
            {pending ? "Saving…" : "Confirm and save"}
          </button>
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => setStep("editing")}>
            Back
          </button>
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={onDone}>
            Cancel
          </button>
        </div>
        {!pending && state.error && <p className="font-medium text-red-700">{state.error}</p>}
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) setStep("confirming");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <label className="block">
          <span className={labelClass}>New rate (LBP per 1 USD)</span>
          <input
            id="rate-input"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={`${inputClass} num text-right`}
            autoFocus
            required
          />
        </label>
        <label className="block">
          <span className={labelClass}>Source</span>
          <select id="rate-source" value={source} onChange={(e) => setSource(e.target.value as Source)} className={inputClass} required>
            <option value="" disabled>
              Choose…
            </option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>Note (optional)</span>
        <input id="rate-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!ready} className={buttonClass("primary")}>
          Review change
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onDone}>
          Cancel
        </button>
      </div>
      {!valid && rate !== "" && <p className="text-sm text-red-700">Enter a positive number, for example 89,700.</p>}
      {valid && unchanged && <p className="text-sm text-stone-500">That&apos;s the current rate.</p>}
      {valid && !unchanged && source === "" && <p className="text-sm text-stone-500">Choose where the rate comes from.</p>}
    </form>
  );
}
