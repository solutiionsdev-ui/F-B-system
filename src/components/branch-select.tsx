"use client";

// All branches or one, remembered for every tab (cookie set by /branch). A GET
// form, so it works before scripts load. `next` keeps the page you're on.
import { useId } from "react";
import { Icon } from "./icons";

export type BranchOption = { id: string; label: string };

export function BranchSelect({
  branches,
  branchId,
  allowAll = true,
  label = "Branch",
  compact = false,
}: {
  branches: BranchOption[];
  branchId: string | null;
  /** Daily Close works on one branch; the other tabs can show all of them together. */
  allowAll?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const id = useId();
  if (branches.length === 0) {
    return <p className="text-xs text-amber-700">No venues assigned to you yet. Ask an owner.</p>;
  }
  if (branches.length === 1) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-stone-600">
        <Icon name="door" size={14} className="text-stone-400" />
        <span className="truncate">{branches[0].label}</span>
      </div>
    );
  }
  return (
    <form action="/branch" method="get" className="relative min-w-0">
      <input type="hidden" name="next" defaultValue="/" />
      <label
        htmlFor={id}
        className={compact ? "sr-only" : "mb-1 block px-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-stone-400"}
      >
        {label}
      </label>
      <select
        id={id}
        name="location"
        defaultValue={branchId ?? ""}
        onChange={(e) => {
          const form = e.currentTarget.form!;
          (form.elements.namedItem("next") as HTMLInputElement).value = window.location.pathname + window.location.search;
          form.requestSubmit();
        }}
        className="w-full appearance-none rounded-lg border border-stone-200/80 bg-white py-1.5 pl-2.5 pr-8 text-[13px] text-stone-900 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
      >
        {allowAll ? <option value="">All branches consolidated</option> : !branchId && <option value="">Choose a branch…</option>}
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute bottom-1.5 right-3 text-stone-400">⌄</span>
      <noscript>
        <button className="mt-1 text-xs text-stone-600 underline">Show</button>
      </noscript>
    </form>
  );
}
