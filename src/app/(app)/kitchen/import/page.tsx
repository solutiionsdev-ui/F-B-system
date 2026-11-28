import Link from "next/link";
import { uploadRecipeWorkbookAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, buttonClass, Card, Field, formatTime } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listRecipeImports } from "@/server/kitchen";
import { KitchenTitle } from "../kitchen-ui";

const STATUS = {
  draft: <Badge tone="warn">Not posted</Badge>,
  posted: <Badge tone="good">Posted</Badge>,
  discarded: <Badge>Discarded</Badge>,
} as const;

/** Kitchen › Import a menu costing workbook: price list, recipes and menu costs. */
export default async function RecipeImportPage() {
  const ctx = await requireContext();
  const canEdit = ctx.can("manage_recipes");
  const imports = await listRecipeImports(await getDb(), ctx.scope);
  return (
    <>
      <KitchenTitle
        title="Import costing workbook"
        subtitle={
          <>
            An Excel workbook with a price list sheet (ingredient, pricing unit, price, notes), a Recipes sheet (one row per ingredient line:
            dish, ingredient, quantity, unit) and a menu costs sheet (selling price, packaging, overhead, target food cost). You see every dish&apos;s
            cost and every problem before anything is saved.{" "}
            <Link href="/kitchen/recipes" className="underline">
              Back to recipes
            </Link>
          </>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Upload"
          actions={
            <a href="/kitchen/import/template" download className={buttonClass("secondary")}>
              <Icon name="file" size={16} /> Download the Excel template
            </a>
          }
        >
          <p className="mb-4 rounded-lg bg-stone-50 px-3 py-2 text-[13px] text-stone-600">
            New to this? Download the template: it has the three sheets with an example dish and sauce filled in, and a sheet explaining each
            column. Fill in your own rows (example rows are skipped), save it, and upload it here. An existing costing workbook in the same
            layout works too.
          </p>
          {canEdit ? (
            <ActionForm action={uploadRecipeWorkbookAction} submitLabel="Read and preview" pendingLabel="Reading the workbook…">
              <Field label="Workbook (.xlsx)" hint="From Google Sheets: File → Download → Microsoft Excel. Up to 5 MB.">
                <input
                  type="file"
                  name="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  required
                  className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-stone-800 hover:file:bg-stone-200"
                />
              </Field>
              <p className="text-xs text-stone-500">
                Importing again later is safe: unchanged recipes and prices are left alone, a changed price is added to the history, and a changed
                recipe becomes a new version.
              </p>
            </ActionForm>
          ) : (
            <p className="text-sm text-stone-600">Only people allowed to edit recipes can import a workbook.</p>
          )}
        </Card>
        <Card title="Earlier imports">
          {imports.length === 0 ? (
            <p className="text-sm text-stone-500">None yet.</p>
          ) : (
            <ul className="-my-1 divide-y divide-stone-100 text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/kitchen/import/${i.id}`} className="block truncate font-medium text-stone-900 hover:underline">
                      {i.fileName}
                    </Link>
                    <span className="text-xs text-stone-500">
                      {formatTime(i.createdAt)}
                      {i.by && <> · {i.by.replace(/\s*\(.*\)$/, "")}</>}
                    </span>
                  </span>
                  {STATUS[i.status]}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
