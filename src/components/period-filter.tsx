// The date-range bar shared by Reports, Cash Closing, Expenses and Cash. A
// plain GET form, so every period is a shareable URL. The branch comes from
// the sidebar's switcher, shared by every screen (spec 2.2 and 4.2).
import Link from "next/link";
import type { ReportFilter } from "@/server/reports";
import { shiftDate } from "@/server/reports";
import { buttonClass, Field, inputClass } from "./ui";

export type PeriodSearch = { from?: string; to?: string };

export function periodPresets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastEnd = shiftDate(monthStart, -1);
  return [
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: `${lastEnd.slice(0, 8)}01`, to: lastEnd },
    { label: "Last 7 days", from: shiftDate(today, -6), to: today },
    { label: "Last 30 days", from: shiftDate(today, -29), to: today },
  ];
}

/** The period in the URL (or this month to today) at the sidebar's branch. Validated by whatever reads it. */
export function readPeriod(sp: PeriodSearch, today: string, branchId: string | null): ReportFilter {
  return { from: sp.from || `${today.slice(0, 8)}01`, to: sp.to || today, locationId: branchId };
}

export function PeriodFilter({
  basePath,
  filter,
  branchLabel,
  today,
}: {
  basePath: string;
  filter: ReportFilter;
  /** The sidebar's branch, shown so the reader knows what the figures cover. */
  branchLabel: string;
  today: string;
}) {
  return (
    <form
      action={basePath}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
    >
      <Field label="From">
        <input type="date" name="from" defaultValue={filter.from} className={inputClass} />
      </Field>
      <Field label="To">
        <input type="date" name="to" defaultValue={filter.to} className={inputClass} />
      </Field>
      <button className={buttonClass("secondary")}>Show</button>
      <span className="self-center text-[13px] text-stone-500">
        Branch: <span className="font-medium text-stone-800">{branchLabel}</span>
      </span>
      <div className="flex flex-wrap gap-0.5 rounded-lg bg-stone-100 p-1 text-[13px] sm:ml-auto">
        {periodPresets(today).map((p) => {
          const pq = new URLSearchParams({ from: p.from, to: p.to });
          const active = p.from === filter.from && p.to === filter.to;
          return (
            <Link
              key={p.label}
              href={`${basePath}?${pq}`}
              aria-current={active ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 ${active ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)]" : "text-stone-500 hover:text-stone-900"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </div>
    </form>
  );
}
