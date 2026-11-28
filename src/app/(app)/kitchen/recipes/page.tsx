import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";
import { formatMicros, formatQuantity, type BaseUnit } from "@/lib/costing";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listRecipes } from "@/server/kitchen";
import { CostStatus, FoodCostPct, formatE4, KitchenTitle } from "../kitchen-ui";

const th = "px-3 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400";

/** Kitchen › Recipes: every dish and prep, with its cost for people who may see food cost. */
export default async function RecipesPage() {
  const ctx = await requireContext();
  const data = await listRecipes(await getDb(), ctx.scope);
  const canEdit = ctx.can("manage_recipes");
  const dishes = data.rows.filter((r) => r.kind === "dish");
  const preps = data.rows.filter((r) => r.kind === "prep");

  return (
    <>
      <KitchenTitle
        title="Recipes"
        subtitle="What goes into each dish, and the sauces and bases (preps) they share. A prep is costed from its own recipe and batch size, so when an ingredient's price changes, every dish using it follows."
        actions={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Link href="/kitchen/import" className={buttonClass("secondary")}>
                Import costing workbook
              </Link>
              <Link href="/kitchen/recipes/new" className={buttonClass("primary")}>
                New recipe
              </Link>
            </div>
          )
        }
      />

      {data.rows.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">
            No recipes yet.{" "}
            {canEdit ? (
              <>
                <Link href="/kitchen/import" className="font-medium underline">
                  Import them from Excel
                </Link>{" "}
                (download the template there, or use your own costing workbook), or add recipes one by one.
              </>
            ) : (
              "Someone allowed to edit recipes adds them."
            )}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card title={`Dishes · ${dishes.length}`} description={data.showCost ? "Cost is ingredients only; packaging is shown on each dish." : undefined}>
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left">
                  <tr>
                    <th className={`${th} pl-5`}>Dish</th>
                    <th className={`${th} text-right`}>Lines</th>
                    {data.showCost && <th className={`${th} text-right`}>Cost</th>}
                    <th className={`${th} text-right`}>Menu price</th>
                    {data.showCost && <th className={`${th} text-right`}>Food cost</th>}
                    <th className={`${th} pr-5`}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {dishes.map((r) => (
                    <tr key={r.id} className="hover:bg-stone-50/70">
                      <td className="px-5 py-2.5">
                        <Link href={`/kitchen/recipes/${r.id}`} className="font-medium text-stone-900 hover:underline">
                          {r.name}
                        </Link>
                        {r.category && <div className="text-xs text-stone-500">{r.category}</div>}
                      </td>
                      <td className="num px-3 py-2.5 text-right text-stone-600">{r.lines}</td>
                      {data.showCost && (
                        <td className="num px-3 py-2.5 text-right">
                          {r.complete ? "" : <span className="text-stone-400">≥ </span>}
                          {formatMicros(r.costMicros!)}
                        </td>
                      )}
                      <td className="num px-3 py-2.5 text-right text-stone-700">{r.priceE4 != null && r.priceCurrency ? formatE4(r.priceE4, r.priceCurrency) : <span className="text-stone-300">—</span>}</td>
                      {data.showCost && (
                        <td className="px-3 py-2.5 text-right">
                          {r.food ? <FoodCostPct bp={r.food.foodCostBp} over={r.food.overTarget} /> : <span className="text-stone-300">—</span>}
                        </td>
                      )}
                      <td className="px-5 py-2.5">
                        <CostStatus complete={r.complete} problems={r.problems} warnings={r.warnings} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Preps · ${preps.length}`} description="Sauces, marinades and bases made in batches and used inside dishes.">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left">
                  <tr>
                    <th className={`${th} pl-5`}>Prep</th>
                    <th className={`${th} text-right`}>One batch makes</th>
                    {data.showCost && <th className={`${th} text-right`}>Batch cost</th>}
                    <th className={`${th} text-right`}>Used in</th>
                    <th className={`${th} pr-5`}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {preps.map((r) => (
                    <tr key={r.id} className="hover:bg-stone-50/70">
                      <td className="px-5 py-2.5">
                        <Link href={`/kitchen/recipes/${r.id}`} className="font-medium text-stone-900 hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="num px-3 py-2.5 text-right text-stone-700">
                        {r.yieldMilli ? formatQuantity(r.yieldMilli, r.yieldUnit as BaseUnit) : <span className="text-red-700">Not set</span>}
                        {r.yieldEstimated && <div className="text-xs text-amber-700">estimated</div>}
                      </td>
                      {data.showCost && <td className="num px-3 py-2.5 text-right">{formatMicros(r.costMicros!)}</td>}
                      <td className="num px-3 py-2.5 text-right text-stone-600">{r.usedBy}</td>
                      <td className="px-5 py-2.5">
                        <CostStatus complete={r.complete} problems={r.problems} warnings={r.yieldEstimated ? 1 : r.warnings} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
