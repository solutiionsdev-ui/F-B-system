// The ingredient's own details: how it's measured, conversions, usable yield,
// supplier. Shared by "add" and "edit".
import { saveIngredientAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";
import { formatScaled } from "@/lib/money";

export type IngredientValues = {
  id?: string;
  name: string;
  baseUnit: "g" | "ml" | "unit";
  gramsPerMlE4: bigint | null;
  gramsPerUnitMilli: bigint | null;
  yieldBp: number;
  category: string | null;
  supplier: string | null;
  note: string | null;
};

const plain = (v: bigint | null, d: number) => (v == null ? "" : formatScaled(v, d).replace(/,/g, ""));

export function IngredientForm({ values }: { values?: IngredientValues }) {
  const v = values;
  return (
    <ActionForm action={saveIngredientAction} submitLabel={v?.id ? "Save ingredient" : "Add ingredient"} variant={v?.id ? "secondary" : "primary"} resetOnSuccess={!v?.id}>
      {v?.id && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <input name="name" defaultValue={v?.name ?? ""} className={inputClass} required maxLength={80} />
        </Field>
        <Field label="Measured in" hint="How recipes and stock count it">
          <select name="baseUnit" defaultValue={v?.baseUnit ?? "g"} className={inputClass}>
            <option value="g">Weight (g, kg)</option>
            <option value="ml">Volume (ml, L)</option>
            <option value="unit">Pieces</option>
          </select>
        </Field>
        <Field label="Usable yield %" hint="What's left after trimming or peeling (avocado ~70)">
          <input name="yieldPct" inputMode="decimal" defaultValue={v ? plain(BigInt(v.yieldBp), 2) : "100"} className={`${inputClass} num text-right`} />
        </Field>
        <Field label="Weight of 1 ml, in g (optional)" hint="Lets a recipe use grams of a liquid priced per litre (oil ≈ 0.91)">
          <input name="gramsPerMl" inputMode="decimal" defaultValue={plain(v?.gramsPerMlE4 ?? null, 4)} className={`${inputClass} num text-right`} />
        </Field>
        <Field label="Weight of one piece, in g (optional)" hint="Lets a recipe use pieces of something priced by weight (egg ≈ 60)">
          <input name="gramsPerUnit" inputMode="decimal" defaultValue={plain(v?.gramsPerUnitMilli ?? null, 3)} className={`${inputClass} num text-right`} />
        </Field>
        <Field label="Supplier (optional)">
          <input name="supplier" defaultValue={v?.supplier ?? ""} className={inputClass} />
        </Field>
        <Field label="Category (optional)">
          <input name="category" defaultValue={v?.category ?? ""} placeholder="e.g. Dairy, Produce, Packaging" className={inputClass} />
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2">
          <input name="note" defaultValue={v?.note ?? ""} className={inputClass} />
        </Field>
      </div>
    </ActionForm>
  );
}
