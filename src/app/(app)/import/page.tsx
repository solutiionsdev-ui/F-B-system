import Link from "next/link";
import { deleteProfileAction, uploadImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, formatTime, inputClass, PageTitle } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listLocations } from "@/server/operations";
import { IMPORT_ROLES, listImports, listProfiles } from "@/server/pos-import";

const STATUS_BADGE = {
  draft: <Badge tone="warn">Not posted</Badge>,
  posted: <Badge tone="good">Imported</Badge>,
  undone: <Badge>Undone</Badge>,
} as const;

export default async function ImportPage() {
  const ctx = await requireContext();
  const db = await getDb();
  const canImport = IMPORT_ROLES.includes(ctx.active.role);
  const [imports, profiles, locs] = await Promise.all([
    listImports(db, ctx.scope),
    listProfiles(db, ctx.scope),
    listLocations(db, ctx.scope),
  ]);

  return (
    <>
      <PageTitle
        title="POS import"
        subtitle="Bring in the day's sales and payments from your POS export instead of typing the totals."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {canImport ? (
            <Card
              step={1}
              title="Upload an export"
              description="Export the payments or transactions report from your POS as CSV or Excel (.xlsx). One day or several."
            >
              <ActionForm action={uploadImportAction} submitLabel="Upload and preview" pendingLabel="Reading the file…">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Location">
                    <select name="locationId" className={inputClass}>
                      {locs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="File" hint="CSV or .xlsx, up to 5 MB">
                    <input
                      type="file"
                      name="file"
                      accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      required
                      className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-stone-800 hover:file:bg-stone-200"
                    />
                  </Field>
                </div>
                <p className="text-xs text-stone-500">
                  Nothing is posted yet. Next you&apos;ll check how the columns were read and see a preview of every day.
                </p>
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-stone-600">Owners and managers can import POS files. You can see past imports below.</p>
            </Card>
          )}

          <Card title="Recent imports">
            {imports.length === 0 ? (
              <p className="text-sm text-stone-500">No imports yet.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                    <tr>
                      <th className="px-5 py-2.5">File</th>
                      <th className="px-3 py-2.5">Location</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Lines</th>
                      <th className="px-5 py-2.5">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {imports.map((i) => (
                      <tr key={i.id} className="hover:bg-stone-50">
                        <td className="max-w-56 truncate px-5 py-2.5">
                          <Link href={`/import/${i.id}`} className="font-medium text-stone-900 hover:underline">
                            {i.fileName}
                          </Link>
                          <div className="text-xs text-stone-500">{i.rowCount} rows</div>
                        </td>
                        <td className="px-3 py-2.5 text-stone-700">{i.locationName}</td>
                        <td className="px-3 py-2.5">{STATUS_BADGE[i.status]}</td>
                        <td className="num px-3 py-2.5 text-right text-stone-700">{i.linesImported ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-stone-600">
                          {formatTime(i.createdAt)}
                          {i.createdByName && <div className="text-xs text-stone-500">{i.createdByName}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card title="Saved POS formats" description="How each POS system's export is read. Saved when you import, reused automatically.">
            {profiles.length === 0 ? (
              <p className="text-sm text-stone-500">None yet. You can save one on your first import.</p>
            ) : (
              <ul className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
                {profiles.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <div className="font-medium text-stone-800">{p.name}</div>
                      <div className="text-xs text-stone-500">
                        Used for {p.uses} import{p.uses === 1 ? "" : "s"}
                      </div>
                    </div>
                    {canImport && (
                      <ActionForm
                        action={deleteProfileAction}
                        submitLabel="Delete"
                        variant="ghost"
                        className="contents"
                        confirmText={`Delete the "${p.name}" format? Past imports aren't affected.`}
                      >
                        <input type="hidden" name="profileId" value={p.id} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Try it with a sample">
            <p className="text-sm text-stone-600">
              A payments export for one evening: split cash in USD and LBP, cards, Whish, two refunds, a void and sales after midnight.
            </p>
            <a href="/samples/sample-pos-export.csv" download className="mt-3 inline-block text-sm font-medium text-brand-700 underline">
              Download sample-pos-export.csv
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}
