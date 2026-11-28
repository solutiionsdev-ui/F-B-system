"use client";

// Adding or changing a recipe. Saving a change to the ingredients or batch
// size makes a new version; the previous one is kept.
import { useState } from "react";
import { saveRecipeAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Field, inputClass } from "@/components/ui";

type Option = { id: string; name: string; baseUnit?: "g" | "ml" | "unit" };
export type EditorLine = { ref: string; quantity: string; unit: string };
export type EditorRecipe = {
  id?: string;
  name: string;
  kind: "dish" | "prep";
  category: string;
  sellingPrice: string;
  priceCurrency: "USD" | "LBP";
  packaging: string;
  targetPct: string;
  yieldQty: string;
  yieldUnit: string;
  lines: EditorLine[];
};

const UNITS = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "L" },
  { value: "unit", label: "piece" },
];

export function RecipeEditor({
  initial,
  ingredients,
  preps,
  defaultTargetPct,
}: {
  initial: EditorRecipe;
  ingredients: Option[];
  preps: Option[];
  defaultTargetPct: string;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [{ ref: "", quantity: "", unit: "g" }]);
  const unitOf = new Map(ingredients.map((i) => [`i:${i.id}`, i.baseUnit ?? "g"]));

  const update = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <ActionForm action={saveRecipeAction} submitLabel={initial.id ? "Save changes" : "Add recipe"} className="space-y-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Field label="Name">
          <input name="name" defaultValue={initial.name} className={inputClass} required maxLength={80} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 block text-xs font-medium text-stone-500">Kind</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1">
            {(["dish", "prep"] as const).map((k) => (
              <label
                key={k}
                className="flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-sm text-stone-600 has-[:checked]:bg-white has-[:checked]:font-medium has-[:checked]:text-stone-900 has-[:checked]:shadow-[0_1px_2px_rgba(28,25,23,0.08)]"
              >
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {k === "dish" ? "Dish (sold)" : "Prep (sauce, base)"}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {kind === "dish" ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Menu price">
            <input name="sellingPrice" inputMode="decimal" defaultValue={initial.sellingPrice} placeholder="0.00" className={`${inputClass} num text-right`} />
          </Field>
          <Field label="Currency">
            <select name="priceCurrency" defaultValue={initial.priceCurrency} className={inputClass}>
              <option value="USD">USD</option>
              <option value="LBP">LBP</option>
            </select>
          </Field>
          <Field label="Packaging per order ($)" hint="Delivery and takeaway">
            <input name="packaging" inputMode="decimal" defaultValue={initial.packaging} placeholder="0" className={`${inputClass} num text-right`} />
          </Field>
          <Field label="Target food cost %" hint={`Blank uses the business's ${defaultTargetPct}%`}>
            <input name="targetPct" inputMode="decimal" defaultValue={initial.targetPct} placeholder={defaultTargetPct} className={`${inputClass} num text-right`} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[200px_160px_minmax(0,1fr)]">
          <Field label="One batch makes">
            <input name="yieldQty" inputMode="decimal" defaultValue={initial.yieldQty} placeholder="e.g. 1500" className={`${inputClass} num text-right`} required />
          </Field>
          <Field label="Unit">
            <select name="yieldUnit" defaultValue={initial.yieldUnit || "g"} className={inputClass}>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="unit">pieces</option>
            </select>
          </Field>
          <p className="self-end pb-2 text-xs text-stone-500">Weigh a finished batch. Dishes use a share of it, so the batch size decides what each portion costs.</p>
        </div>
      )}

      <Field label="Category (optional)">
        <input name="category" defaultValue={initial.category} placeholder="e.g. Breakfast, Sauces" className={inputClass} />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Ingredients</h3>
          <span className="text-xs text-stone-500">Quantities as plated, before trimming losses (set those on the ingredient)</span>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_88px_88px_32px] gap-2">
              <select
                name="line_ref"
                value={l.ref}
                onChange={(e) => update(i, { ref: e.target.value, unit: unitOf.get(e.target.value) ?? l.unit })}
                aria-label={`Ingredient ${i + 1}`}
                className={inputClass}
              >
                <option value="">Choose…</option>
                <optgroup label="Ingredients">
                  {ingredients.map((o) => (
                    <option key={o.id} value={`i:${o.id}`}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
                {preps.length > 0 && (
                  <optgroup label="Preps">
                    {preps.map((o) => (
                      <option key={o.id} value={`r:${o.id}`}>
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <input
                name="line_qty"
                inputMode="decimal"
                value={l.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                placeholder="Qty"
                aria-label={`Quantity ${i + 1}`}
                className={`${inputClass} num text-right`}
              />
              <select name="line_unit" value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} aria-label={`Unit ${i + 1}`} className={inputClass}>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}
                className="rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-900"
                aria-label={`Remove line ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, { ref: "", quantity: "", unit: "g" }])} className={`${buttonClass("secondary")} mt-2`}>
          Add a line
        </button>
      </div>

      {initial.id && (
        <Field label="What changed (optional)" hint="Kept with this version">
          <input name="note" placeholder="e.g. Portion of cheese raised to 25 g" className={inputClass} />
        </Field>
      )}
    </ActionForm>
  );
}
