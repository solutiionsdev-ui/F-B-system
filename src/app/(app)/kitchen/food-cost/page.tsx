import Link from "next/link";
import { updateFoodCostSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, Kpi } from "@/components/ui";
import { formatBp, formatMicros } from "@/lib/costing";
import { formatScaled } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getFoodCost } from "@/server/kitchen";
import { CostStatus, FoodCostPct, KitchenTitle } from "../kitchen-ui";

const pct = (bp: number) => formatScaled(BigInt(bp), 2);

/** Kitchen › Food Cost: each dish's ingredient cost against its menu price and the target. */
export default async function FoodCostPage() {
  const ctx = await requireContext();
  if (!ctx.can("view_food_cost")) {
    return (
      <>
        <KitchenTitle title="Food Cost" />
        <Card>
          <p className="text-sm text-stone-600">Food cost is for owners and accountants. An owner can give you access in Team &amp; Permissions.</p>
        </Card>
      </>
    );
  }
  const d = await getFoodCost(await getDb(), ctx.scope);
  const s = d.settings;
  const isOwner = ctx.active.role === "owner";

  return (
    <>
      <KitchenTitle
        title="Food Cost"
        subtitle={
          <>
            Ingredient cost per portion against the menu price{s.vatBp != null ? " without VAT" : ""}, at today&apos;s ingredient prices. Not net profit:
            labour, rent and other costs come on top.
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Dishes over target"
          value={<span className={d.counts.overTarget ? "text-red-700" : ""}>{d.counts.overTarget}</span>}
          sub={`of ${d.counts.priced} dishes with a menu price · target ${formatBp(s.targetBp)}`}
        />
        <Kpi label="Average food cost" value={d.averageBp != null ? formatBp(d.averageBp) : "—"} sub="Simple average across priced dishes" />
        <Kpi
          label="Not fully costed"
          value={<span className={d.counts.incomplete ? "text-red-700" : ""}>{d.counts.incomplete}</span>}
          sub={
            <>
              dishes ·{" "}
              <Link href="/kitchen/inventory?show=missing" className="underline">
                {d.counts.ingredientsWithoutPrice} ingredients without a price
              </Link>
            </>
          }
        />
        <Kpi label="Batch sizes to confirm" value={<span className={d.counts.estimatedBatches ? "text-amber-700" : ""}>{d.counts.estimatedBatches}</span>} sub="Preps whose batch size was estimated" />
      </div>

      {d.rateMissing && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No exchange rate is set, so LBP prices can&apos;t be converted.</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Every dish, worst first" description="≥ means some lines can't be costed yet, so the real food cost is higher. Price at target puts food cost (with packaging) exactly on target.">
          {d.dishes.length === 0 ? (
            <p className="text-sm text-stone-500">
              No dishes yet.{" "}
              <Link href="/kitchen/import" className="underline">
                Import your costing workbook
              </Link>
              .
            </p>
          ) : (
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                  <tr>
                    <th className="px-5 py-2.5">Dish</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    <th className="px-3 py-2.5 text-right">Menu price</th>
                    <th className="px-3 py-2.5 text-right">Food cost</th>
                    <th className="px-3 py-2.5 text-right">Margin</th>
                    <th className="px-3 py-2.5 text-right">Price at target</th>
                    <th className="px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {d.dishes.map((x) => (
                    <tr key={x.id} className="hover:bg-stone-50/70">
                      <td className="px-5 py-2.5">
                        <Link href={`/kitchen/recipes/${x.id}`} className="font-medium text-stone-900 hover:underline">
                          {x.name}
                        </Link>
                        {x.targetBp !== s.targetBp && <div className="text-xs text-stone-500">target {formatBp(x.targetBp)}</div>}
                      </td>
                      <td className="num px-3 py-2.5 text-right">
                        {x.complete ? "" : <span className="text-stone-400">≥ </span>}
                        {formatMicros(x.costMicros)}
                      </td>
                      <td className="num px-3 py-2.5 text-right text-stone-700">{x.food ? formatMicros(x.food.priceMicros) : <span className="text-stone-400">not set</span>}</td>
                      <td className="px-3 py-2.5 text-right">{x.food ? <FoodCostPct bp={x.food.foodCostBp} over={x.food.overTarget} /> : "—"}</td>
                      <td className="num px-3 py-2.5 text-right text-stone-700">{x.food ? formatMicros(x.food.marginMicros) : "—"}</td>
                      <td className="num px-3 py-2.5 text-right text-stone-700">{x.food ? formatMicros(x.food.priceAtTargetMicros) : "—"}</td>
                      <td className="px-5 py-2.5">
                        <CostStatus complete={x.complete} problems={x.problems.length} warnings={x.warnings.length} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Settings">
          {isOwner ? (
            <ActionForm action={updateFoodCostSettingsAction} submitLabel="Save settings" variant="secondary">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target food cost %">
                  <input name="target" inputMode="decimal" defaultValue={pct(s.targetBp)} className={`${inputClass} num text-right`} required />
                </Field>
                <Field label="Overhead %" hint="Only for the sheet's price method">
                  <input name="overhead" inputMode="decimal" defaultValue={pct(s.overheadBp)} className={`${inputClass} num text-right`} />
                </Field>
              </div>
              <label className="flex items-start gap-2 text-sm text-stone-700">
                <input type="checkbox" name="vatIncluded" defaultChecked={s.vatBp != null} className="mt-0.5 accent-brand-700" />
                <span>
                  Menu prices include VAT
                  <span className="block text-xs text-stone-500">Then food cost is measured on the price without VAT. Confirm with your accountant.</span>
                </span>
              </label>
              <Field label="VAT rate %">
                <input name="vat" inputMode="decimal" defaultValue={s.vatBp != null ? pct(s.vatBp) : ""} placeholder="e.g. 11" className={`${inputClass} num text-right`} />
              </Field>
            </ActionForm>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-stone-500">Target food cost</dt>
                <dd className="num">{formatBp(s.targetBp)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Overhead</dt>
                <dd className="num">{formatBp(s.overheadBp)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-500">Menu prices include VAT</dt>
                <dd>{s.vatBp != null ? `Yes, ${formatBp(s.vatBp)}` : "Not set"}</dd>
              </div>
            </dl>
          )}
          {s.overheadBp > 0 && (
            <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
              Your sheet&apos;s suggested price adds {formatBp(s.overheadBp)} overhead and then divides by the target, so it lands at about{" "}
              {formatBp(Math.round((s.targetBp * 10000) / (10000 + s.overheadBp)))} food cost, not {formatBp(s.targetBp)}. Both prices are on each dish&apos;s page.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
