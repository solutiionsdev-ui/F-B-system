import Link from "next/link";
import { Icon } from "@/components/icons";
import { formatDate, Money } from "@/components/ui";
import type { CostShare } from "@/lib/cost-alert";
import { formatScaled } from "@/lib/money";
import type { getCostAlert } from "@/server/cost-alert";

type Alert = Awaited<ReturnType<typeof getCostAlert>>;

/** 6683 → "66.8%". */
const pct = (bp: number) => `${formatScaled(BigInt(Math.round(bp / 10)), 1)}%`;
const signed = (bp: number) => `${bp > 0 ? "+" : bp < 0 ? "−" : ""}${pct(Math.abs(bp))}`;
const range = (f: { from: string; to: string }) => `${formatDate(f.from, { day: "numeric", month: "short" })} – ${formatDate(f.to, { day: "numeric", month: "short" })}`;

/**
 * The red notice at the top of Performance when running costs take a bigger
 * share of sales than in the 30 days before, with what went up and the price
 * change that would bring the share back.
 */
export function CostAlertNotice({
  alert,
  foodCost,
  isOwner,
}: {
  alert: Alert;
  /** Dishes over their food-cost target, when the viewer may see food cost. */
  foodCost: { overTarget: number; targetBp: number } | null;
  isOwner: boolean;
}) {
  if (!alert.show || !alert.overall) return null;
  const o = alert.overall;
  const worst = alert.branches[0];
  // Headline: the whole business when it crossed the line, otherwise the branch that did.
  const head: CostShare & { name?: string } = o.riseBp >= alert.thresholdBp ? o : worst;
  const where = head === o ? (alert.branches.length === 1 ? ` at ${alert.branches[0].name}` : "") : ` at ${worst.name}`;
  const rising = alert.categories.filter((c) => c.pointsBp > 0).slice(0, 3);
  const salesFell = head.salesChangeBp <= -alert.thresholdBp && head.costsChangeBp < alert.thresholdBp;
  const q = new URLSearchParams({ from: alert.window.from, to: alert.window.to });
  if (alert.window.locationId) q.set("location", alert.window.locationId);

  return (
    <section role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-950">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white sm:flex">
          <Icon name="alert" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Costs are up {pct(head.riseBp)} against sales{where}
            </h2>
            <span className="text-xs text-red-800/80">
              {range(alert.window)} vs {range(alert.previous)}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6">
            Running costs (every expense: salaries, food and drinks, generator and electricity, rent, packaging and the rest) took{" "}
            <strong>{pct(head.shareNowBp)}</strong> of sales, up from {pct(head.shareBeforeBp)}. Costs{" "}
            <Money minor={head.costsNow} currency="USD" /> ({signed(head.costsChangeBp)}), sales <Money minor={head.salesNow} currency="USD" /> (
            {signed(head.salesChangeBp)}).
          </p>

          {head === o && rising.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-red-800/80">What went up</div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {rising.map((c) => (
                  <li key={c.name}>
                    <span className="font-medium">{c.name}</span>: {pct(c.shareBeforeBp)} → {pct(c.shareNowBp)} of sales
                    {c.nowEq > c.beforeEq && (
                      <span className="text-red-800/80">
                        {" "}
                        (+<Money minor={c.nowEq - c.beforeEq} currency="USD" />)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alert.branches.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {alert.branches.map((b) => (
                <span
                  key={b.locationId}
                  className={`rounded-full px-2.5 py-1 font-medium ${b.over ? "bg-red-600 text-white" : "bg-white/70 text-red-900 ring-1 ring-red-200"}`}
                >
                  {b.name} {signed(b.riseBp)}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-sm ring-1 ring-red-200">
            <span className="font-semibold">Suggestion: review your menu prices.</span> At today&apos;s costs, prices would need to go up about{" "}
            <strong>{pct(head.riseBp)}</strong> on average to bring costs back to {pct(head.shareBeforeBp)} of sales, if you sell the same amount.
            {salesFell && (
              <> Sales fell {pct(-head.salesChangeBp)}, so fixed costs like rent and salaries weigh more: check whether fewer customers is the cause before raising prices.</>
            )}
            {foodCost && foodCost.overTarget > 0 && (
              <>
                {" "}
                {foodCost.overTarget} dish{foodCost.overTarget === 1 ? "" : "es"} cost more than the {pct(foodCost.targetBp)} food-cost target.
              </>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-medium">
              <Link href={`/performance/ledger?${q}`} className="underline underline-offset-2">
                See the expenses
              </Link>
              {foodCost && (
                <Link href="/kitchen/food-cost" className="underline underline-offset-2">
                  See suggested dish prices
                </Link>
              )}
            </div>
          </div>

          <p className="mt-2 text-xs text-red-800/80">
            Shown when the cost share of sales grows by {pct(alert.thresholdBp)} or more.
            {isOwner && (
              <>
                {" "}
                <Link href="/settings/business" className="underline">
                  Change this
                </Link>
                .
              </>
            )}
            {alert.notCompared.length > 0 && <> Not compared yet (fewer than 7 days with sales in one of the periods): {alert.notCompared.join(", ")}.</>}
          </p>
        </div>
      </div>
    </section>
  );
}
