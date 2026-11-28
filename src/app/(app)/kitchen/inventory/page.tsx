import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, buttonClass, Card, formatTime } from "@/components/ui";
import { formatPrice } from "@/lib/costing";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listIngredients } from "@/server/kitchen";
import { KitchenTitle } from "../kitchen-ui";
import { IngredientForm } from "./ingredient-form";

const UNIT = { g: "Weight", ml: "Volume", unit: "Pieces" } as const;

/** Kitchen › Inventory. Stage A: the ingredient price list. Stock on hand, purchases and counts come next. */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const data = await listIngredients(await getDb(), ctx.scope);
  const canEdit = ctx.can("manage_recipes");
  const missing = data.rows.filter((r) => !r.archived && !r.hasPrice);
  const rows = data.rows.filter((r) => !r.archived && (sp.show !== "missing" || !r.hasPrice));

  return (
    <>
      <KitchenTitle
        title="Inventory"
        subtitle="Every ingredient, how it's measured and what it costs now. Each new price is kept with its date and supplier, and every recipe using the ingredient is recosted. Stock on hand, purchases and counts come in the next stage."
        actions={
          canEdit && (
            <Link href="/kitchen/import?kind=prices" className={buttonClass("secondary")}>
              <Icon name="import" size={16} /> Import prices from Excel
            </Link>
          )
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title={`Ingredients · ${rows.length}`}
          actions={
            <div className="flex gap-0.5 rounded-lg bg-stone-100 p-1 text-[13px]">
              <Link href="/kitchen/inventory" className={`rounded-md px-2.5 py-1 ${sp.show !== "missing" ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)]" : "text-stone-500"}`}>
                All
              </Link>
              <Link href="/kitchen/inventory?show=missing" className={`rounded-md px-2.5 py-1 ${sp.show === "missing" ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)]" : "text-stone-500"}`}>
                No price · {missing.length}
              </Link>
            </div>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-stone-500">{sp.show === "missing" ? "Every ingredient has a price." : "No ingredients yet. Add one, or import your price list from Excel."}</p>
          ) : (
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                  <tr>
                    <th className="px-5 py-2.5">Ingredient</th>
                    <th className="px-3 py-2.5">Measured in</th>
                    {data.showCost && <th className="px-3 py-2.5 text-right">Current price</th>}
                    <th className="px-3 py-2.5 text-right">Yield</th>
                    <th className="px-5 py-2.5 text-right">In recipes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-stone-50/70">
                      <td className="px-5 py-2.5">
                        <Link href={`/kitchen/inventory/${r.id}`} className="font-medium text-stone-900 hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs text-stone-500">{[r.category, r.supplier].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-2.5 text-stone-600">{UNIT[r.baseUnit]}</td>
                      {data.showCost && (
                        <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                          {r.price ? (
                            <>
                              {formatPrice(r.price)}
                              <div className="text-xs text-stone-500">{formatTime(r.price.effectiveAt)}</div>
                            </>
                          ) : (
                            <Badge tone="bad">No price</Badge>
                          )}
                        </td>
                      )}
                      <td className="num px-3 py-2.5 text-right text-stone-600">{r.yieldBp === 10000 ? "100%" : `${r.yieldBp / 100}%`}</td>
                      <td className="num px-5 py-2.5 text-right text-stone-600">{r.usedIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {canEdit && (
          <Card title="Add an ingredient" description="Set its price on the next page.">
            <IngredientForm />
          </Card>
        )}
      </div>
    </>
  );
}
