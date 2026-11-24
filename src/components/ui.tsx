import type { ReactNode } from "react";
import { formatAmount, type Currency } from "@/lib/money";

export const inputClass =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-xs placeholder:text-stone-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-stone-100";

/** Same look as inputClass, sized to its content (for selects inside a sentence or row). */
export const inlineInputClass =
  "inline-block w-auto rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 shadow-xs focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20";

export const labelClass = "block text-xs font-medium text-stone-600 mb-1";

export function buttonClass(variant: "primary" | "secondary" | "danger" | "ghost" = "primary") {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const variants = {
    primary: "bg-brand-700 text-white hover:bg-brand-800 focus-visible:ring-brand-600",
    secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 focus-visible:ring-stone-400",
    danger: "bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-600",
    ghost: "text-stone-600 hover:text-stone-900 hover:bg-stone-100",
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
}: {
  title?: ReactNode;
  step?: number;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-stone-200 bg-white shadow-xs ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div className="flex items-start gap-3">
            {step != null && (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white">
                {step}
              </span>
            )}
            <div>
              <h2 className="text-[15px] font-semibold text-stone-900">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-stone-500">{description}</p>}
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
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A money amount. `variance` colours shortages red and overages amber. */
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

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
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

export const PAID_FROM_LABELS: Record<string, string> = {
  drawer: "Cash drawer",
  petty_cash: "Petty cash",
  bank: "Bank / transfer",
  owner: "Owner paid",
};
