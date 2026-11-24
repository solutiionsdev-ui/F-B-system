"use client";

// One square per day, Monday-first weeks as columns. Colour is the cash
// difference after corrections, on a diverging scale: red arm = short, blue
// arm = over, grey = balanced (within tolerance). Open days are outlined in
// the accent; days with no business day are dashed. Every square has its own
// tooltip and is focusable, and the daily table below is the text version.
import { useState } from "react";

const SHORT = ["#ef8f89", "#d9453f", "#a82a27"];
const OVER = ["#86b6ef", "#3987e5", "#1c5cab"];
const BALANCED = "#dcd9d2";
const ACCENT = "#eb6834";

export type CalendarDay = { date: string; varianceAfterEq: number; closed: number; open: number; flagged: number };

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(cents) / 100);
const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function bucket(cents: number, tol: number) {
  const a = Math.abs(cents);
  if (a <= tol) return -1;
  return a <= 1000 ? 0 : a <= 5000 ? 1 : 2; // up to $10, up to $50, more
}

function describe(d: CalendarDay, tol: number) {
  if (d.closed === 0 && d.open === 0) return "No business day";
  if (d.closed === 0) return `Open, not closed yet`;
  const b = bucket(d.varianceAfterEq, tol);
  const state = b < 0 ? "Balanced" : `${d.varianceAfterEq < 0 ? "Short" : "Over"} ${usd(d.varianceAfterEq)}`;
  const extra = d.open ? ` · ${d.open} still open` : "";
  return `${state} · ${d.closed} closed${extra}`;
}

/** Text inside a fill: white on the darker steps, ink on the lighter ones. */
function inkOn(d: CalendarDay, tol: number) {
  if (d.closed === 0) return "#57534e";
  const b = bucket(d.varianceAfterEq, tol);
  return b >= 1 ? "#ffffff" : "#1c1917";
}

function cellStyle(d: CalendarDay, tol: number): React.CSSProperties {
  if (d.closed === 0 && d.open === 0) return { background: "transparent", border: "1px dashed #d6d3cc" };
  if (d.closed === 0) return { background: "#fff", boxShadow: `inset 0 0 0 1.5px ${ACCENT}` };
  const b = bucket(d.varianceAfterEq, tol);
  if (b < 0) return { background: BALANCED };
  return { background: (d.varianceAfterEq < 0 ? SHORT : OVER)[b] };
}

export function CashCalendar({ days, toleranceCents }: { days: CalendarDay[]; toleranceCents: number }) {
  const [hover, setHover] = useState<{ d: CalendarDay; x: number; y: number } | null>(null);
  if (days.length === 0) return null;

  // Pad to whole Monday-first weeks.
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (CalendarDay | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = cells.length / 7;
  const size = weeks > 26 ? 12 : weeks > 14 ? 16 : 20;
  const gap = 3;

  const months: { col: number; label: string }[] = [];
  for (let c = 0; c < weeks; c++) {
    const d = cells.slice(c * 7, c * 7 + 7).find(Boolean);
    if (!d) continue;
    const label = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`));
    if (!months.length || months[months.length - 1].label !== label) months.push({ col: c, label });
  }

  const show = (d: CalendarDay, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const p = el.closest("[data-calendar]")!.getBoundingClientRect();
    setHover({ d, x: r.left - p.left + r.width / 2, y: r.top - p.top });
  };
  const cellProps = (d: CalendarDay) => ({
    type: "button" as const,
    "aria-label": `${longDate(d.date)}: ${describe(d, toleranceCents)}`,
    onPointerEnter: (e: React.PointerEvent<HTMLButtonElement>) => show(d, e.currentTarget),
    onFocus: (e: React.FocusEvent<HTMLButtonElement>) => show(d, e.currentTarget),
    onPointerLeave: () => setHover(null),
    onBlur: () => setHover(null),
  });

  // Up to six weeks reads best as an ordinary calendar with date numbers.
  if (weeks <= 6) {
    return (
      <div className="relative" data-calendar>
        <div className="grid max-w-[420px] grid-cols-7 gap-1.5 text-center">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((l) => (
            <div key={l} className="pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-stone-400">
              {l}
            </div>
          ))}
          {cells.map((d, i) =>
            d ? (
              <button
                key={d.date}
                {...cellProps(d)}
                className="flex aspect-square items-start justify-start rounded-lg p-1.5 text-[11px] font-medium outline-none transition-transform hover:scale-105 focus-visible:scale-105 focus-visible:ring-2 focus-visible:ring-stone-900"
                style={{ ...cellStyle(d, toleranceCents), color: inkOn(d, toleranceCents) }}
              >
                {Number(d.date.slice(8))}
              </button>
            ) : (
              <span key={`pad-${i}`} />
            ),
          )}
        </div>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium">{longDate(hover.d.date)}</div>
          <div className="text-stone-300">{describe(hover.d, toleranceCents)}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.06em] text-stone-500">
        <span className="flex items-center gap-1.5">
          Short
          {[...SHORT].reverse().map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
          ))}
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: BALANCED }} />
          {OVER.map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
          ))}
          Over
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-white" style={{ boxShadow: `inset 0 0 0 1.5px ${ACCENT}` }} />
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-stone-300" />
          No business day
        </span>
        <span>Shades: up to $10 · up to $50 · more</span>
      </div>
      </div>
    );
  }

  return (
    <div className="relative" data-calendar>
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-2">
          <div className="flex flex-col pt-5 font-mono text-[10px] uppercase text-stone-400" style={{ gap }}>
            {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((l, i) => (
              <div key={i} style={{ height: size, lineHeight: `${size}px` }}>
                {l}
              </div>
            ))}
          </div>
          <div>
            <div className="relative h-5 font-mono text-[10px] uppercase text-stone-400">
              {months.map((mo) => (
                <span key={`${mo.col}-${mo.label}`} className="absolute" style={{ left: mo.col * (size + gap) }}>
                  {mo.label}
                </span>
              ))}
            </div>
            <div
              className="grid grid-flow-col"
              style={{ gridTemplateRows: `repeat(7, ${size}px)`, gridAutoColumns: `${size}px`, gap }}
              role="group"
              aria-label="Cash difference by day"
            >
              {cells.map((d, i) =>
                d ? (
                  <button
                    key={d.date}
                    {...cellProps(d)}
                    className="rounded-[4px] outline-none transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-stone-900"
                    style={cellStyle(d, toleranceCents)}
                  />
                ) : (
                  <span key={`pad-${i}`} />
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium">{longDate(hover.d.date)}</div>
          <div className="text-stone-300">{describe(hover.d, toleranceCents)}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] uppercase tracking-[0.06em] text-stone-500">
        <span className="flex items-center gap-1.5">
          Short
          {[...SHORT].reverse().map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
          ))}
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: BALANCED }} />
          {OVER.map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
          ))}
          Over
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-white" style={{ boxShadow: `inset 0 0 0 1.5px ${ACCENT}` }} />
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-stone-300" />
          No business day
        </span>
        <span>Shades: up to $10 · up to $50 · more</span>
      </div>
    </div>
  );
}
