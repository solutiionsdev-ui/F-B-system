"use client";

// The compact exchange-rate badge at the top of Daily Close (v2.1). It shows
// the rate this business day uses. Opening it shows the active rate and, for
// people allowed to change it (owners by default), a guarded editor.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { RateEditor } from "@/components/rate-editor";

export function RateBadge({
  dayRate,
  active,
  canEdit,
}: {
  /** The rate locked on this business day, if it's open or closed ("89,700"). */
  dayRate: string | null;
  /** The rate new days will use. */
  active: { text: string; source: string; when: string; by: string | null } | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // Open toward whichever side has room, so the panel never runs off the page.
  const [alignRight, setAlignRight] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setEditing(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);

  const shown = dayRate ?? active?.text ?? null;
  const differs = dayRate != null && active != null && dayRate !== active.text;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={(e) => {
          if (open) return close();
          const r = e.currentTarget.getBoundingClientRect();
          setAlignRight(r.right - Math.min(window.innerWidth * 0.92, 380) >= 8);
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[13px] font-medium text-stone-800 shadow-[0_1px_2px_rgba(28,25,23,0.05)] hover:bg-stone-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15"
      >
        <Icon name="rate" size={14} className="text-stone-400" />
        <span className="num">{shown ? `1 USD = ${shown} LBP` : "No rate set"}</span>
        <span className="text-stone-400" aria-hidden>
          ⌄
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Exchange rate"
          className={`absolute ${alignRight ? "right-0" : "left-0"} z-20 mt-2 w-[min(92vw,380px)] rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-[0_12px_32px_rgba(28,25,23,0.14)]`}
        >
          <dl className="space-y-2">
            {dayRate && (
              <div>
                <dt className="text-xs font-medium text-stone-500">This business day</dt>
                <dd className="num text-base font-semibold text-stone-900">1 USD = {dayRate} LBP</dd>
                <dd className="text-xs text-stone-500">Locked when the day was opened. Changing the rate never changes this day.</dd>
              </div>
            )}
            <div className={dayRate ? "border-t border-stone-100 pt-2" : ""}>
              <dt className="text-xs font-medium text-stone-500">Active rate for new days</dt>
              {active ? (
                <>
                  <dd className="num text-base font-semibold text-stone-900">1 USD = {active.text} LBP</dd>
                  <dd className="text-xs text-stone-500">
                    {active.source} · {active.when}
                    {active.by && <> · set by {active.by}</>}
                  </dd>
                </>
              ) : (
                <dd className="text-stone-600">Not set yet. Days can&apos;t be opened until a rate is set.</dd>
              )}
              {differs && <dd className="mt-1 text-xs text-amber-700">This day keeps its own rate; the active rate applies to days opened after it was set.</dd>}
            </div>
          </dl>

          <div className="mt-3 border-t border-stone-100 pt-3">
            {editing ? (
              <RateEditor currentText={active?.text ?? null} onDone={close} />
            ) : canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700">
                  {active ? "Change the rate" : "Set the first rate"}
                </button>
                <Link href="/settings/rates" className="text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
                  Rate history
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                <span>Only an owner, or someone they allow, can change the rate.</span>
                <Link href="/settings/rates" className="underline-offset-2 hover:text-stone-900 hover:underline">
                  Rate history
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
