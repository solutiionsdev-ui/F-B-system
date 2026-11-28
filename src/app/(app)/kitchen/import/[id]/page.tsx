import Link from "next/link";
import { notFound } from "next/navigation";
import { discardRecipeImportAction, postRecipeImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, formatTime } from "@/components/ui";
import { formatBp, formatMicros, formatPrice } from "@/lib/costing";
import type { Issue } from "@/lib/menu-workbook";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getRecipeImport } from "@/server/kitchen";
import { FoodCostPct, KitchenTitle } from "../../kitchen-ui";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-medium text-stone-500">{label}</div>
      <div className={`num text-lg font-semibold ${tone ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: Issue[]; tone: "bad" | "warn" | "neutral" }) {
  if (issues.length === 0) return null;
  const box = { bad: "border-red-200 bg-red-50/60 text-red-900", warn: "border-amber-200 bg-amber-50/60 text-amber-950", neutral: "border-stone-200 bg-stone-50 text-stone-700" }[tone];
  return (
    <details open={tone !== "neutral"} className={`rounded-xl border px-4 py-3 text-sm ${box}`}>
      <summary className="cursor-pointer font-semibold">
        {title} · {issues.length}
      </summary>
      <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
        {issues.map((i, n) => (
          <li key={n}>
            <span className="font-medium">{i.subject}</span>
            {i.row != null && <span className="text-xs opacity-70"> ({i.sheet} row {i.row})</span>}: {i.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function RecipeImportPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const d = await getRecipeImport(await getDb(), ctx.scope, id);
  if (!d) notFound();
  const imp = d.import;
  const errors = d.plan.issues.filter((i) => i.level === "error");
  const warnings = d.plan.issues.filter((i) => i.level === "warning");
  const infos = d.plan.issues.filter((i) => i.level === "info");
  const showCost = ctx.can("view_food_cost");
  const dishes = d.dishes.filter((x) => x.kind === "dish");
  const preps = d.dishes.filter((x) => x.kind === "prep");
  // A price list on its own (imported from Inventory): no recipes, so no dishes or settings to show.
  const pricesOnly = d.plan.recipes.length === 0;
  const setsSettings = d.plan.settings.targetBp != null || d.plan.settings.overheadBp != null;
  const summary = imp.summary as null | { ingredientsAdded: number; pricesAdded: number; ingredientsUpdated?: number; recipesAdded: number; recipesUpdated: number; versionsAdded: number; settings: boolean; unitClashes: string[] };

  return (
    <>
      <KitchenTitle
        title={
          <span className="flex flex-wrap items-center gap-3">
            {imp.fileName}
            {imp.status === "draft" && <Badge tone="warn">Not posted yet</Badge>}
            {imp.status === "posted" && <Badge tone="good">Posted</Badge>}
            {imp.status === "discarded" && <Badge>Discarded</Badge>}
          </span>
        }
        subtitle={
          <>
            Uploaded {formatTime(imp.createdAt)} ·{" "}
            <Link href="/kitchen/import" className="underline">
              all imports
            </Link>
          </>
        }
      />

      {imp.status === "posted" && summary && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {pricesOnly ? (
            <>
              Posted {imp.postedAt && formatTime(imp.postedAt)}: {summary.ingredientsAdded} ingredients added, {summary.pricesAdded} prices recorded
              {summary.ingredientsUpdated ? `, ${summary.ingredientsUpdated} ingredients' usable % or weights updated` : ""}. Recipes using them are
              recosted.{" "}
              <Link href="/kitchen/inventory" className="font-medium underline">
                See the inventory
              </Link>
            </>
          ) : (
            <>
              Posted {imp.postedAt && formatTime(imp.postedAt)}: {summary.ingredientsAdded} ingredients and {summary.recipesAdded} recipes added,{" "}
              {summary.pricesAdded} prices recorded, {summary.versionsAdded} recipe versions written{summary.settings ? ", target and overhead set" : ""}.{" "}
              <Link href="/kitchen/recipes" className="font-medium underline">
                See the recipes
              </Link>
            </>
          )}
          {summary.unitClashes.length > 0 && <div className="mt-1 text-amber-800">Measured differently from before, so their prices weren&apos;t changed: {summary.unitClashes.join(", ")}.</div>}
        </div>
      )}

      {pricesOnly ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Ingredients" value={d.plan.ingredients.length} />
          <Stat label="New prices" value={d.diff.ingredients.repriced} />
          <Stat label="To fix" value={errors.length} tone={errors.length ? "text-red-700" : undefined} />
          <Stat label="To check" value={warnings.length} tone={warnings.length ? "text-amber-700" : undefined} />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Ingredients" value={d.plan.ingredients.length} />
          <Stat label="Dishes" value={dishes.length} />
          <Stat label="Preps" value={preps.length} />
          <Stat label="To fix" value={errors.length} tone={errors.length ? "text-red-700" : undefined} />
          <Stat label="To check" value={warnings.length} tone={warnings.length ? "text-amber-700" : undefined} />
          <Stat label="Target / overhead" value={`${d.plan.settings.targetBp != null ? formatBp(d.plan.settings.targetBp) : "—"} / ${d.plan.settings.overheadBp != null ? formatBp(d.plan.settings.overheadBp) : "—"}`} />
        </div>
      )}

      {imp.status === "draft" && (
        <Card className="mb-6" title="What posting will do">
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
            <li>
              Ingredients: {d.diff.ingredients.added} new, {d.diff.ingredients.repriced} with a new price (added to their history),{" "}
              {d.diff.ingredients.detailed > 0 && <>{d.diff.ingredients.detailed} with new usable % or weights, </>}
              {d.diff.ingredients.unchanged} unchanged.
              {d.diff.ingredients.unitClash.length > 0 && <> Measured differently from what&apos;s saved, so left alone: {d.diff.ingredients.unitClash.join(", ")}.</>}
            </li>
            {!pricesOnly && (
              <li>
                Recipes: {d.diff.recipes.added} new, {d.diff.recipes.changed.length} changed (a new version each{d.diff.recipes.changed.length ? `: ${d.diff.recipes.changed.slice(0, 6).join(", ")}${d.diff.recipes.changed.length > 6 ? "…" : ""}` : ""}), {d.diff.recipes.unchanged} unchanged.
              </li>
            )}
            {setsSettings &&
              (d.isOwner ? (
                <li>The business&apos;s target food cost and overhead are set from the workbook.</li>
              ) : (
                <li>The target and overhead stay as they are (only owners change them).</li>
              ))}
            {pricesOnly ? (
              <li>Recipes aren&apos;t touched; every recipe using a repriced ingredient is recosted. Rows listed under &ldquo;To fix&rdquo; are skipped.</li>
            ) : (
              <li>Lines listed under &ldquo;To fix&rdquo; are skipped. Ingredients without a price are added, and the dishes using them show as not fully costed.</li>
            )}
          </ul>
          {d.canPost && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
              <ActionForm action={postRecipeImportAction.bind(null, imp.id)} submitLabel={pricesOnly ? "Post these prices" : "Post this workbook"} pendingLabel="Saving…" className="contents" confirmText={pricesOnly ? "Save these ingredients and prices?" : "Save these ingredients, prices and recipes?"}>
                <span />
              </ActionForm>
              <ActionForm action={discardRecipeImportAction.bind(null, imp.id)} submitLabel="Discard" variant="ghost" className="contents" confirmText="Discard this workbook? Nothing from it is saved.">
                <span />
              </ActionForm>
            </div>
          )}
        </Card>
      )}

      {d.ingredientsToFix.length > 0 && (
        <Card
          className="mb-6"
          title={`Ingredients to fix · ${d.ingredientsToFix.length}`}
          description="Each stops some dishes being fully costed. Your sheet counted these lines as zero. After posting, open each ingredient in Inventory to add its price or its weight per ml or per piece; every dish using it is recosted."
        >
          <ul className="-my-1 divide-y divide-stone-100 text-sm">
            {d.ingredientsToFix.map((x) => (
              <li key={x.name} className="py-2">
                <div className="font-medium text-stone-900">{x.name}</div>
                <div className="text-stone-600">{x.problem}</div>
                <div className="text-xs text-stone-500">
                  {x.recipes.length} recipe{x.recipes.length === 1 ? "" : "s"}: {x.recipes.slice(0, 6).join(", ")}
                  {x.recipes.length > 6 ? "…" : ""}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {imp.status === "draft" && showCost && d.diff.ingredients.changes.length > 0 && (
        <Card className="mb-6" title={`Price changes · ${d.diff.ingredients.changes.length}`} description="Against each ingredient's current price, per kg, litre or piece. New ingredients aren't listed.">
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Ingredient</th>
                  <th className="px-3 py-2.5">Was</th>
                  <th className="px-3 py-2.5">Now</th>
                  <th className="px-5 py-2.5 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[...d.diff.ingredients.changes]
                  .sort((a, b) => (b.changeBp ?? 0) - (a.changeBp ?? 0))
                  .map((c) => (
                    <tr key={c.name}>
                      <td className="px-5 py-2.5 font-medium text-stone-900">{c.name}</td>
                      <td className="px-3 py-2.5 text-stone-500">{c.from ? formatPrice(c.from) : "No price yet"}</td>
                      <td className="px-3 py-2.5">{formatPrice(c.to)}</td>
                      <td className={`num px-5 py-2.5 text-right font-medium ${c.changeBp == null ? "text-stone-400" : c.changeBp > 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {c.changeBp == null ? "—" : `${c.changeBp > 0 ? "+" : c.changeBp < 0 ? "−" : ""}${formatBp(Math.abs(c.changeBp))}`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mb-6 space-y-3">
        <IssueList title="To fix (skipped or can't be costed)" issues={errors} tone="bad" />
        <IssueList title="To check" issues={warnings} tone="warn" />
        <IssueList title="For your information" issues={infos} tone="neutral" />
      </div>

      {showCost && dishes.length > 0 && (
        <Card title="Dishes as they'd be costed" description="Worst food cost first. Ingredients only; prices from this workbook. A dish marked ≥ has lines that can't be costed yet.">
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Dish</th>
                  <th className="px-3 py-2.5 text-right">Cost</th>
                  <th className="px-3 py-2.5 text-right">Food cost</th>
                  <th className="px-3 py-2.5 text-right">Price at target</th>
                  <th className="px-5 py-2.5">Problems</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {dishes.map((x) => (
                  <tr key={x.name} className="align-top">
                    <td className="px-5 py-2.5 font-medium text-stone-900">{x.name}</td>
                    <td className="num px-3 py-2.5 text-right">
                      {x.complete ? "" : <span className="text-stone-400">≥ </span>}
                      {formatMicros(x.costMicros)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{x.food ? <FoodCostPct bp={x.food.foodCostBp} over={x.food.overTarget} /> : <span className="text-stone-400">no price</span>}</td>
                    <td className="num px-3 py-2.5 text-right text-stone-700">{x.food ? formatMicros(x.food.priceAtTargetMicros) : "—"}</td>
                    <td className="px-5 py-2.5 text-xs text-red-700">{x.problems.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
