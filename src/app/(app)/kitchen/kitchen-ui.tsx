// Small pieces shared by the Kitchen tabs.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { formatBp, formatMicros } from "@/lib/costing";
import { divRound, formatScaled, type Currency } from "@/lib/money";

/** A menu price stored in ten-thousandths of its currency. */
export function formatE4(e4: bigint, currency: Currency) {
  return currency === "USD" ? formatMicros(e4 * 100n) : `LBP ${formatScaled(divRound(e4, 10_000n), 0)}`;
}

/** Plain input text for a stored e4 value ("8", "0.18"). */
export function e4Input(e4: bigint | null, currency: Currency = "USD") {
  if (e4 == null || e4 === 0n) return "";
  return currency === "USD" ? formatScaled(e4, 4).replace(/,/g, "") : formatScaled(divRound(e4, 10_000n), 0).replace(/,/g, "");
}

export function CostStatus({ complete, problems, warnings }: { complete: boolean; problems: number; warnings: number }) {
  if (!complete) return <Badge tone="bad">{problems} to fix</Badge>;
  if (warnings) return <Badge tone="warn">Check batch size</Badge>;
  return <Badge tone="good">Costed</Badge>;
}

/** Food cost % against the target: red over target, green within. */
export function FoodCostPct({ bp, over }: { bp: number; over: boolean }) {
  return <span className={`num font-medium ${over ? "text-red-700" : "text-emerald-700"}`}>{formatBp(bp)}</span>;
}

export function KitchenTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-stone-500">Kitchen</div>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-3xl text-sm text-stone-500">{subtitle}</div>}
      </div>
      {actions}
    </div>
  );
}
