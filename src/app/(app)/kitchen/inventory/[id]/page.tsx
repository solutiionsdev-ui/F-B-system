import Link from "next/link";
import { notFound } from "next/navigation";
import { setIngredientPriceAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, formatTime, inputClass } from "@/components/ui";
import { formatPrice } from "@/lib/costing";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getIngredient } from "@/server/kitchen";
import { KitchenTitle } from "../../kitchen-ui";
import { IngredientForm } from "../ingredient-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE = { manual: "Entered", import: "Workbook", purchase: "Purchase" } as const;

export default async function IngredientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const d = await getIngredient(await getDb(), ctx.scope, id);
  if (!d) notFound();
  const i = d.ingredient;
  const canEdit = ctx.can("manage_recipes");
  const natural = i.baseUnit === "g" ? "kg" : i.baseUnit === "ml" ? "L" : "piece";

  return (
    <>
      <KitchenTitle
        title={i.name}
        subtitle={
          <>
            {i.baseUnit === "g" ? "Measured by weight" : i.baseUnit === "ml" ? "Measured by volume" : "Counted in pieces"}
            {i.yieldBp !== 10000 && <> · {i.yieldBp / 100}% usable after trimming</>}
            {i.supplier && <> · {i.supplier}</>} ·{" "}
            <Link href="/kitchen/inventory" className="underline">
              all ingredients
            </Link>
          </>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {d.showCost && (
            <Card title="Price history" description="Prices are never edited: each new price is added with its date, supplier and who entered it.">
              {d.prices.length === 0 ? (
                <p className="text-sm text-red-700">No price yet. Recipes using it can&apos;t be fully costed.</p>
              ) : (
                <div className="-mx-5 -my-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                      <tr>
                        <th className="px-5 py-2.5">From</th>
                        <th className="px-3 py-2.5 text-right">Price</th>
                        <th className="px-3 py-2.5">Supplier</th>
                        <th className="px-5 py-2.5">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {d.prices.map((p, n) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap px-5 py-2.5 text-stone-700">
                            {formatTime(p.effectiveAt)} {n === 0 && <Badge tone="good">Current</Badge>}
                          </td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-right font-medium text-stone-900">{formatPrice(p)}</td>
                          <td className="px-3 py-2.5 text-stone-600">{p.supplier}</td>
                          <td className="px-5 py-2.5 text-xs text-stone-500">
                            {SOURCE[p.source]}
                            {p.by && <> · {p.by.replace(/\s*\(.*\)$/, "")}</>}
                            {p.note && <div>{p.note}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          <Card title={`Used in · ${d.usedIn.length}`}>
            {d.usedIn.length === 0 ? (
              <p className="text-sm text-stone-500">Not in any recipe yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {d.usedIn.map((u) => (
                  <li key={u.id}>
                    <Link href={`/kitchen/recipes/${u.id}`} className="rounded-md bg-stone-100 px-2 py-1 text-stone-800 hover:bg-stone-200">
                      {u.name}
                      {u.kind === "prep" && <span className="text-stone-500"> · prep</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {canEdit && (
          <div className="min-w-0 space-y-6">
            <Card title="New price" description="Added to the history; recipes are recosted straight away.">
              <ActionForm action={setIngredientPriceAction} submitLabel="Save price" resetOnSuccess>
                <input type="hidden" name="ingredientId" value={i.id} />
                <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                  <Field label="Price">
                    <input name="price" inputMode="decimal" className={`${inputClass} num text-right`} required />
                  </Field>
                  <Field label="Currency">
                    <select name="currency" defaultValue="USD" className={inputClass}>
                      <option value="USD">USD</option>
                      <option value="LBP">LBP</option>
                    </select>
                  </Field>
                  <Field label="For">
                    <select name="pack" defaultValue={natural} className={inputClass}>
                      {i.baseUnit === "g" && <option value="kg">per kg</option>}
                      {i.baseUnit === "ml" && <option value="L">per litre</option>}
                      {i.baseUnit === "unit" && <option value="piece">per piece</option>}
                      <option value="pack">per pack of…</option>
                    </select>
                  </Field>
                  <Field label={`Pack (${i.baseUnit === "unit" ? "pieces" : i.baseUnit})`}>
                    <input name="packSize" inputMode="decimal" placeholder="e.g. 30" className={`${inputClass} num text-right`} />
                  </Field>
                  <Field label="Supplier (optional)" className="col-span-2">
                    <input name="supplier" defaultValue={i.supplier ?? ""} className={inputClass} />
                  </Field>
                </div>
                <p className="text-xs text-stone-500">LBP prices are converted at the active exchange rate when dishes are costed.</p>
              </ActionForm>
            </Card>
            <Card title="Details">
              <IngredientForm values={i} />
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
