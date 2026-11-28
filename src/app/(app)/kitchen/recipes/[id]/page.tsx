import Link from "next/link";
import { notFound } from "next/navigation";
import { archiveRecipeAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, formatTime } from "@/components/ui";
import { costPerYieldUnit, formatBp, formatMicros, formatQuantity, type BaseUnit } from "@/lib/costing";
import { formatScaled } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getRecipe } from "@/server/kitchen";
import { CostStatus, e4Input, formatE4, KitchenTitle } from "../../kitchen-ui";
import { RecipeEditor } from "../recipe-editor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold text-stone-900" : "text-stone-600"}`}>
      <dt>
        {label}
        {hint && <span className="block text-xs font-normal text-stone-400">{hint}</span>}
      </dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const d = await getRecipe(await getDb(), ctx.scope, id);
  if (!d) notFound();
  const r = d.recipe;
  const canEdit = ctx.can("manage_recipes");
  const target = r.targetBp ?? d.settings.targetBp;
  const perUnit = r.kind === "prep" && d.version?.yieldMilli && d.version.yieldUnit && d.costMicros != null ? costPerYieldUnit(d.costMicros, d.version.yieldMilli, d.version.yieldUnit) : null;

  return (
    <>
      <KitchenTitle
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.name}
            <Badge tone={r.kind === "dish" ? "info" : "neutral"}>{r.kind === "dish" ? "Dish" : "Prep"}</Badge>
            {r.archived && <Badge>Archived</Badge>}
          </span>
        }
        subtitle={
          <>
            {r.category && <>{r.category} · </>}
            Version {d.version?.version ?? 0}
            {r.kind === "prep" && d.version?.yieldMilli && d.version.yieldUnit && (
              <> · one batch makes {formatQuantity(d.version.yieldMilli, d.version.yieldUnit as BaseUnit)}{d.version.yieldEstimated ? " (estimated)" : ""}</>
            )}{" "}
            ·{" "}
            <Link href="/kitchen/recipes" className="underline">
              all recipes
            </Link>
          </>
        }
        actions={<CostStatus complete={d.complete} problems={d.problems.length} warnings={d.warnings.length} />}
      />

      {(d.problems.length > 0 || d.warnings.length > 0) && (
        <div className="mb-6 space-y-2">
          {d.problems.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <div className="font-semibold">Not fully costed: {d.problems.length} line{d.problems.length === 1 ? "" : "s"} can&apos;t be priced, so the cost below is too low.</div>
              <ul className="mt-1 list-disc pl-5">
                {d.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {d.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {d.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Ingredients" description={d.showCost ? "Cost per line at today's prices, after each ingredient's usable yield." : undefined}>
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Ingredient</th>
                  <th className="px-3 py-2.5 text-right">Quantity</th>
                  {d.showCost && <th className="px-5 py-2.5 text-right">Cost</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {d.lines.map((l, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-5 py-2.5">
                      {l.line.ingredientId ? (
                        <Link href={`/kitchen/inventory/${l.line.ingredientId}`} className="font-medium text-stone-900 hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        <Link href={`/kitchen/recipes/${l.line.subRecipeId}`} className="font-medium text-stone-900 hover:underline">
                          {l.name} <span className="text-xs font-normal text-stone-500">prep</span>
                        </Link>
                      )}
                      {l.problem && <div className="text-xs text-red-700">{l.problem}</div>}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-right text-stone-700">{formatQuantity(l.line.quantityMilli, l.line.unit)}</td>
                    {d.showCost && <td className="num px-5 py-2.5 text-right">{l.costMicros != null ? formatMicros(l.costMicros) : <span className="text-red-700">—</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          {d.showCost && d.costMicros != null && (
            <Card title={r.kind === "dish" ? "Food cost" : "Batch cost"}>
              <dl className="space-y-1.5 text-sm">
                <Row label={r.kind === "dish" ? "Ingredients per portion" : "Ingredients per batch"} value={`${d.complete ? "" : "≥ "}${formatMicros(d.costMicros)}`} strong />
                {perUnit && <Row label={`Per ${perUnit.per}`} value={formatMicros(perUnit.micros)} />}
                {r.kind === "dish" && (
                  <>
                    {r.packagingE4 > 0n && <Row label="Packaging per order" value={formatMicros(r.packagingE4 * 100n)} hint="Delivery and takeaway" />}
                    <Row label="Menu price" value={r.sellingPriceE4 != null && r.priceCurrency ? formatE4(r.sellingPriceE4, r.priceCurrency) : "Not set"} />
                    {d.food && (
                      <>
                        {d.settings.vatBp != null && <Row label="Price without VAT" value={formatMicros(d.food.netPriceMicros)} hint={`VAT ${formatBp(d.settings.vatBp)} included in menu prices`} />}
                        <div className="border-t border-stone-200 pt-1.5" />
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="font-semibold text-stone-900">Food cost</dt>
                          <dd className={`num text-lg font-semibold ${d.food.overTarget ? "text-red-700" : "text-emerald-700"}`}>{formatBp(d.food.foodCostBp)}</dd>
                        </div>
                        <Row label="Target" value={formatBp(target)} />
                        <Row label="Margin after ingredients and packaging" value={formatMicros(d.food.marginMicros)} />
                        <div className="border-t border-stone-200 pt-1.5" />
                        <Row label={`Price at ${formatBp(target)} food cost`} value={formatMicros(d.food.priceAtTargetMicros)} />
                        {d.settings.overheadBp > 0 && (
                          <Row label={`Your sheet's method (+${formatBp(d.settings.overheadBp)} overhead)`} value={formatMicros(d.food.sheetPriceMicros)} hint="Lands below the target food cost" />
                        )}
                      </>
                    )}
                  </>
                )}
              </dl>
              {!d.complete && <p className="mt-3 text-xs text-red-700">Some lines can&apos;t be costed yet, so the real cost is higher.</p>}
            </Card>
          )}

          {d.usedIn.length > 0 && (
            <Card title="Used in">
              <ul className="space-y-1 text-sm">
                {d.usedIn.map((u) => (
                  <li key={u.id}>
                    <Link href={`/kitchen/recipes/${u.id}`} className="text-stone-800 hover:underline">
                      {u.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Versions" description="Every change to the ingredients or batch size is kept.">
            <ul className="space-y-2 text-sm">
              {d.history.map((h) => (
                <li key={h.id} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="font-medium text-stone-900">v{h.version}</span>
                    {h.note && <span className="text-stone-600"> · {h.note}</span>}
                  </span>
                  <span className="whitespace-nowrap text-xs text-stone-500">
                    {formatTime(h.createdAt)}
                    {h.by && <> · {h.by.replace(/\s*\(.*\)$/, "")}</>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {canEdit && (
        <div className="mt-6 space-y-6">
          <details className="rounded-2xl border border-stone-200/80 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
            <summary className="cursor-pointer text-[15px] font-semibold text-stone-900">Change this recipe</summary>
            <div className="mt-4">
              <RecipeEditor
                defaultTargetPct={formatScaled(BigInt(d.settings.targetBp), 2)}
                ingredients={d.options.ingredients}
                preps={d.options.preps}
                initial={{
                  id: r.id,
                  name: r.name,
                  kind: r.kind,
                  category: r.category ?? "",
                  sellingPrice: e4Input(r.sellingPriceE4, r.priceCurrency ?? "USD"),
                  priceCurrency: r.priceCurrency ?? "USD",
                  packaging: e4Input(r.packagingE4),
                  targetPct: r.targetBp != null ? formatScaled(BigInt(r.targetBp), 2) : "",
                  yieldQty: d.version?.yieldMilli ? formatScaled(d.version.yieldMilli, 3).replace(/,/g, "") : "",
                  yieldUnit: d.version?.yieldUnit ?? "g",
                  lines: d.lines.map((l) => ({
                    ref: l.line.ingredientId ? `i:${l.line.ingredientId}` : `r:${l.line.subRecipeId}`,
                    quantity: formatScaled(l.line.quantityMilli, 3).replace(/,/g, ""),
                    unit: l.line.unit,
                  })),
                }}
              />
            </div>
          </details>
          <ActionForm
            action={archiveRecipeAction}
            submitLabel={r.archived ? "Restore recipe" : "Archive recipe"}
            variant="ghost"
            confirmText={r.archived ? undefined : `Archive ${r.name}? It leaves the lists; its history is kept and it can be restored.`}
          >
            <input type="hidden" name="recipeId" value={r.id} />
            <input type="hidden" name="archived" value={r.archived ? "false" : "true"} />
          </ActionForm>
        </div>
      )}
    </>
  );
}
