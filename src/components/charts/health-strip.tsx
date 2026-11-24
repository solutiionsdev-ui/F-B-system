// The last 14 days of one location as a strip of thin bars: grey balanced,
// red short, blue over, orange still open, a short pale stub when there was
// no business day. Each bar links to its day; the caption names the counts so
// colour is never the only signal.
import Link from "next/link";
import type { HealthState, HealthTick } from "@/server/today";

const COLOR: Record<HealthState, string> = {
  balanced: "#a8a29e",
  short: "#d9453f",
  over: "#3987e5",
  open: "#eb6834",
  none: "#e7e5e0",
};
const LABEL: Record<HealthState, string> = {
  balanced: "Balanced",
  short: "Short",
  over: "Over",
  open: "Open",
  none: "No business day",
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const money = (cents: bigint) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents < 0n ? -cents : cents) / 100);

export function HealthStrip({ ticks }: { ticks: HealthTick[] }) {
  const count = (s: HealthState) => ticks.filter((t) => t.state === s).length;
  const short = count("short");
  const over = count("over");
  const open = count("open");
  const balanced = count("balanced");
  const parts = [short && `${short} short`, over && `${over} over`, open && `${open} open`].filter(Boolean) as string[];
  const summary = parts.length ? parts.join(" · ") : balanced ? "All balanced" : "No days yet";

  return (
    <div>
      <div
        className="flex h-7 items-end gap-[3px]"
        role="img"
        aria-label={`Last 14 days: ${balanced} balanced, ${short} short, ${over} over, ${open} open, ${count("none")} with no business day.`}
      >
        {ticks.map((t) => {
          const title = `${day(t.date)}: ${LABEL[t.state]}${
            (t.state === "short" || t.state === "over") && t.varianceEq != null ? ` ${money(t.varianceEq)}` : ""
          }`;
          const bar = (
            <span
              className={`block w-[6px] rounded-[2px] transition-opacity group-hover:opacity-80 ${t.state === "none" ? "h-2.5" : "h-7"}`}
              style={{ background: COLOR[t.state] }}
            />
          );
          return t.dayId ? (
            <Link key={t.date} href={`/days/${t.dayId}`} title={title} aria-label={title} className="group block">
              {bar}
            </Link>
          ) : (
            <span key={t.date} title={title} className="block">
              {bar}
            </span>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-stone-400">
        <span>14 days</span>
        <span className={short ? "text-red-600" : ""}>{summary}</span>
      </div>
    </div>
  );
}
