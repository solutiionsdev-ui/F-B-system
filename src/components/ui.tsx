import type { ReactNode } from "react";
import { formatAmount, type Currency } from "@/lib/money";

export const inputClass =
  "block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-stone-100";

/** Same look as inputClass, sized to its content (for selects inside a sentence or row). */
export const inlineInputClass =
  "inline-block w-auto rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-900 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15";

export const labelClass = "block text-xs font-medium text-stone-500 mb-1.5";

export function buttonClass(variant: "primary" | "secondary" | "danger" | "ghost" = "primary") {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const variants = {
    primary: "bg-ink text-white hover:bg-stone-700 focus-visible:ring-stone-500",
    secondary: "border border-stone-200 bg-white text-stone-800 hover:bg-stone-50 focus-visible:ring-stone-400",
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
    ghost: "text-stone-500 hover:text-stone-900 hover:bg-stone-100",
  };
  return `${base} ${variants[variant]}`;
}

export function Card({
  title,
  step,
  description,
  actions,
  children,
  className = "",
  id,
}: {
  id?: string;
  title?: ReactNode;
  step?: number;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-6 rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-start gap-2.5">
            {step != null && (
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-semibold text-white">
                {step}
              </span>
            )}
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] leading-5 text-stone-500">{description}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const tones = {
  neutral: "bg-stone-100 text-stone-600",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
  accent: "bg-amber-50 text-amber-700",
};
export type Tone = keyof typeof tones;

/** A status pill: soft tint, never colour alone (always a word). */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Small "↗ 6.1%" change chip, coloured by whether the direction is good. */
export function Delta({ pct, upIsGood = true, label }: { pct: number | null; upIsGood?: boolean; label?: string }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.5;
  const good = flat ? null : up === upIsGood;
  const cls = good == null ? "bg-stone-100 text-stone-600" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
  return (
    <span className={`num inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${cls}`} title={label}>
      <span aria-hidden>{flat ? "→" : up ? "↗" : "↘"}</span>
      {up && !flat ? "+" : ""}
      {pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
      {label && <span className="sr-only"> {label}</span>}
    </span>
  );
}

/** A money amount. `variance` colours shortages red, overages blue and zero green. */
export function Money({
  minor,
  currency,
  signed,
  variance,
  className = "",
}: {
  minor: bigint;
  currency: Currency;
  signed?: boolean;
  variance?: boolean;
  className?: string;
}) {
  const tone = variance ? (minor < 0n ? "text-red-700" : minor > 0n ? "text-amber-700" : "text-emerald-700") : "";
  return <span className={`num whitespace-nowrap ${tone} ${className}`}>{formatAmount(minor, currency, { signed })}</span>;
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

/** A headline figure tile: label, big value, optional chip and one line under it. */
export function Kpi({ label, value, chip, sub }: { label: string; value: ReactNode; chip?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] text-stone-500">{label}</span>
        {chip}
      </div>
      <div className="mt-3 text-[26px] font-semibold leading-none tracking-tight text-stone-900">{value}</div>
      {sub && <div className="mt-2.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">{title}</h1>
        {subtitle && <div className="mt-1.5 text-sm text-stone-500">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}

/** A section heading inside a tab (the tab itself has the page's one big title). */
export function SectionTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">{title}</h2>
        {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function formatTime(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Beirut",
  }).format(d);
}

export const REASON_LABELS: Record<string, string> = {
  counting_error: "Counting error",
  unrecorded_expense: "Unrecorded expense",
  change_shortage: "Change given wrongly",
  rate_rounding: "Exchange-rate rounding",
  suspected_loss: "Suspected loss",
  other: "Other",
};

export { PAID_FROM_LABELS } from "@/lib/expense-buckets";

/** The app mark: an ink square with an orange cut. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink text-white"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M15.5 8.2c-.7-1-2-1.7-3.5-1.7-2 0-3.5 1-3.5 2.6 0 3.6 7.2 1.8 7.2 5.4 0 1.6-1.6 2.7-3.7 2.7-1.7 0-3.1-.7-3.8-1.9M12 4.5v15" />
      </svg>
      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
    </span>
  );
}

/** Small mono caps label: table headers, chart axes, legends, timestamps. */
export const microClass = "font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400";
