import Link from "next/link";
import { deleteProfileAction, uploadImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, buttonClass, Card, Field, formatTime, inputClass, SectionTitle } from "@/components/ui";
import { EXPORT_ACCEPT } from "@/lib/pos-import";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listImports, listProfiles } from "@/server/pos-import";

const STATUS_BADGE = {
  draft: <Badge tone="warn">Not posted</Badge>,
  posted: <Badge tone="good">Imported</Badge>,
  undone: <Badge>Undone</Badge>,
} as const;

/**
 * Settings & Log › Omega POS formats: how each export is read, the history of
 * every import (file, rows, format, who and when), and a back-fill upload for
 * a file covering several days. Tonight's file is imported in Daily Close.
 */
export default async function PosFormatsPage() {
  const ctx = await requireContext();
  const db = await getDb();
  const canImport = ctx.can("import_pos");
  const [imports, profiles] = await Promise.all([listImports(db, ctx.scope, ctx.branch?.id ?? null), listProfiles(db, ctx.scope)]);
  const locs = ctx.branch ? [ctx.branch, ...ctx.branches.filter((b) => b.id !== ctx.branch!.id)] : ctx.branches;

  return (
    <>
      <SectionTitle
        title="Omega POS formats"
        subtitle={
          <>
            How each POS export is read. A file whose columns match a saved format uses it; anything else stops and asks for the columns
            to be matched. Tonight&apos;s file is imported from{" "}
            <Link href="/close#step-1" className="underline">
              Daily Close
            </Link>
            .
          </>
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card title="Saved formats" description="The exact mapping used is stored with each import, so changing or deleting a format never changes past imports.">
            {profiles.length === 0 ? (
              <p className="text-sm text-stone-500">None yet. Match the columns of a first import and save it as a format.</p>
            ) : (
              <ul className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
                {profiles.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-stone-800">
                        {p.name} <Badge tone="good">Active</Badge>
                      </div>
                      {p.note && <div className="mt-0.5 text-xs text-stone-500">{p.note}</div>}
                      <div className="text-xs text-stone-500">
                        Used for {p.uses} import{p.uses === 1 ? "" : "s"} · updated {formatTime(p.updatedAt)}
                      </div>
                    </div>
                    {canImport && (
                      <ActionForm
                        action={deleteProfileAction}
                        submitLabel="Delete"
                        variant="ghost"
                        className="contents"
                        confirmText={`Delete the "${p.name}" format? Past imports keep the mapping they used.`}
                      >
                        <input type="hidden" name="profileId" value={p.id} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Import history" description="Every upload, with the file, its rows, who uploaded it and when. Posted rows are linked to their day.">
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
          <Card title="Try it with a sample">
            <p className="text-sm text-stone-600">
              A fictional Omega daily sales and payment export for one evening: cash in USD and LBP, cards, Toters and NokNok, a split payment,
              a discount, a void, a refund, VAT and two sales after midnight. It&apos;s dated for the latest day with no business day yet.
            </p>
            <a href="/import/sample" download="sample-omega-export.csv" className={`${buttonClass("secondary")} mt-3`}>
              <Icon name="file" size={16} /> Download sample-omega-export.csv
            </a>
          </Card>
          {canImport && (
            <Card title="Back-fill several days" description="For a file covering more than one business day. You check the columns and every day before anything is posted.">
              <ActionForm action={uploadImportAction} submitLabel="Upload and review" pendingLabel="Reading the file…" variant="secondary">
                <Field label="Location">
                  <select name="locationId" className={inputClass}>
                    {locs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="File" hint="CSV, Excel (.xlsx) or PDF, up to 5 MB">
                  <input
                    type="file"
                    name="file"
                    accept={EXPORT_ACCEPT}
                    className="block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-stone-800 hover:file:bg-stone-200"
                  />
                </Field>
                <Field label="Or a Google Sheets link" hint="Shared as “Anyone with the link can view”. A chosen file is used first.">
                  <input name="sheetUrl" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
