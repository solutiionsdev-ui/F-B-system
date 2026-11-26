// The date-range and location bar shared by Reports, Cash Closing, Expenses
// and Cash. A plain GET form, so every view is a shareable URL.
import Link from "next/link";
import type { ReportFilter } from "@/server/reports";
import { shiftDate } from "@/server/reports";
import { buttonClass, Field, inputClass } from "./ui";

export type PeriodSearch = { from?: string; to?: string; location?: string };

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

/** The filter in the URL, or this month to today. Validated by whatever reads it. */
export function readPeriod(sp: PeriodSearch, today: string): ReportFilter {
  return { from: sp.from || `${today.slice(0, 8)}01`, to: sp.to || today, locationId: sp.location || null };
}

export function PeriodFilter({
  basePath,
  filter,
  locations,
  today,
}: {
  basePath: string;
  filter: ReportFilter;
  locations: { id: string; name: string }[];
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
      {locations.length > 1 && (
        <Field label="Location">
          <select name="location" defaultValue={filter.locationId ?? ""} className={inputClass}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <button className={buttonClass("secondary")}>Show</button>
      <div className="flex flex-wrap gap-0.5 rounded-lg bg-stone-100 p-1 text-[13px] sm:ml-auto">
        {periodPresets(today).map((p) => {
          const pq = new URLSearchParams({ from: p.from, to: p.to });
          if (filter.locationId) pq.set("location", filter.locationId);
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
