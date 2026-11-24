import Link from "next/link";
import { notFound } from "next/navigation";
import { applyProfileAction, postImportAction, saveMappingAction, undoImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, formatDate, formatTime, inlineInputClass, inputClass, Money, PageTitle } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getImport, IMPORT_ROLES } from "@/server/pos-import";
import { MappingForm } from "./mapping-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`num text-xl font-semibold ${tone ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const data = await getImport(await getDb(), ctx.scope, id);
  if (!data) notFound();
  const imp = data.import;
  const p = data.preview;
  const canImport = IMPORT_ROLES.includes(ctx.active.role);

  return (
    <>
      <PageTitle
        title={
          <span className="flex flex-wrap items-center gap-3">
            {imp.fileName}
            {imp.status === "draft" && <Badge tone="warn">Not posted yet</Badge>}
            {imp.status === "posted" && <Badge tone="good">Imported</Badge>}
            {imp.status === "undone" && <Badge>Undone</Badge>}
          </span>
        }
        subtitle={
          <>
            {data.location.name} · {imp.rowCount} rows · uploaded {formatTime(imp.createdAt)} ·{" "}
            <Link href="/import" className="underline">
              all imports
            </Link>
          </>
        }
      />

      {data.sameFilePosted.length > 0 && imp.status === "draft" && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This exact file was already imported for {data.sameFilePosted.map((f) => f.locationName).join(", ")}
          {data.sameFilePosted[0].postedAt && <> on {formatTime(data.sameFilePosted[0].postedAt)}</>}.{" "}
          {data.sameFilePosted.some((f) => f.locationId === imp.locationId)
            ? "Rows already in the system will be skipped."
            : `Check you picked the right location: importing it into ${data.location.name} too would count these sales twice.`}
        </div>
      )}

      {imp.status !== "draft" ? (
        <Card title={imp.status === "posted" ? "Imported" : "This import was undone"}>
          {imp.status === "posted" ? (
            <div className="space-y-4 text-sm">
              <p className="text-stone-700">
                <span className="font-semibold">{imp.linesImported}</span> lines added
                {imp.daysCreated ? (
                  <>
                    , <span className="font-semibold">{imp.daysCreated}</span> business day{imp.daysCreated === 1 ? "" : "s"} opened
                  </>
                ) : null}
                {imp.rowsSkipped ? <> · {imp.rowsSkipped} rows skipped</> : null}. Count the drawer and close each day as usual.
              </p>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {data.posted.map((d) => (
                  <li key={d.dayId} className="flex items-center justify-between px-3 py-2">
                    <Link href={`/days/${d.dayId}`} className="font-medium text-stone-900 hover:underline">
                      {formatDate(d.date)}
                    </Link>
                    <span className="flex items-center gap-3 text-stone-600">
                      {d.lines} lines {d.status === "open" ? <Badge tone="info">Open</Badge> : <Badge>Closed</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
              {canImport &&
                (data.canUndo ? (
                  <ActionForm
                    action={undoImportAction.bind(null, imp.id)}
                    submitLabel="Undo this import"
                    variant="secondary"
                    confirmText="Remove every line this import added? Days it opened stay open and empty."
                  >
                    <span />
                  </ActionForm>
                ) : (
                  <p className="text-xs text-stone-500">Can&apos;t be undone: a day it added to is closed. Use adjustments on that day.</p>
                ))}
            </div>
          ) : (
            <p className="text-sm text-stone-600">Its lines were removed {imp.undoneAt && formatTime(imp.undoneAt)}. Upload the file again to re-import.</p>
          )}
        </Card>
      ) : (
        p && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <Card
                step={1}
                title="Match the columns"
                description="We guessed from the column names. Fix anything that's wrong; the preview updates."
                actions={
                  data.profiles.length > 0 && canImport ? (
                    <ActionForm
                      action={applyProfileAction.bind(null, imp.id)}
                      submitLabel="Apply"
                      variant="ghost"
                      className="flex items-center gap-1"
                      footerClassName="flex-nowrap"
                    >
                      <select name="profileId" defaultValue={imp.profileId ?? ""} className={inlineInputClass} aria-label="Saved POS format">
                        <option value="" disabled>
                          Saved format…
                        </option>
                        {data.profiles.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  ) : null
                }
              >
                <div className="-mx-5 -mt-4 mb-4 overflow-x-auto border-b border-stone-100 bg-stone-50/60">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-stone-500">
                        {imp.headers.map((h) => (
                          <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono text-stone-700">
                      {imp.sample.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-stone-100">
                          {r.map((c, j) => (
                            <td key={j} className="whitespace-nowrap px-3 py-1.5">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canImport ? (
                  <MappingForm action={saveMappingAction.bind(null, imp.id)} headers={imp.headers} mapping={data.mapping} />
                ) : (
                  <p className="text-sm text-stone-500">Only owners and managers can change the mapping.</p>
                )}
              </Card>
            </div>

            <div className="min-w-0 space-y-6">
              <Card step={2} title="Check the preview" description="Exactly what would be posted. Nothing is saved until you import.">
                {p.setup.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
                    {p.setup.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Count label="Will import" value={p.counts.toImport} tone="text-emerald-700" />
                      <Count label="Already in" value={p.counts.alreadyImported} />
                      <Count label="Problems" value={p.counts.problems} tone={p.counts.problems ? "text-red-700" : undefined} />
                      <Count label="Skipped" value={p.counts.skipped + p.counts.blocked + p.counts.duplicatesInFile} />
                    </div>
                    {p.counts.duplicatesInFile > 0 && (
                      <p className="text-xs text-amber-800">
                        {p.counts.duplicatesInFile} row(s) share an ID with an earlier row in the file and were left out. If they&apos;re
                        different payments, add another ID column (like a payment line number).
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                          <tr>
                            <th className="pb-2 pr-2">Business day</th>
                            <th className="pb-2 pr-2 text-right">Lines</th>
                            <th className="pb-2 pr-2 text-right">Cash</th>
                            <th className="pb-2 text-right">Collected</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {p.days.map((d) => (
                            <tr key={d.date} className="align-top">
                              <td className="py-2 pr-2">
                                <div className="font-medium text-stone-900">{formatDate(d.date)}</div>
                                <div className="mt-0.5">
                                  {d.dayStatus === "new" && <Badge tone="info">Will open</Badge>}
                                  {d.dayStatus === "open" && <Badge tone="good">Open</Badge>}
                                  {d.dayStatus === "closed" && <Badge>Closed</Badge>}
                                </div>
                                {d.rate && <div className="mt-1 text-xs text-stone-500">Rate {formatRate(parseRate(d.rate))}</div>}
                                {d.rateNote && <div className="text-xs text-amber-700">{d.rateNote}</div>}
                                {d.blocked && <div className="mt-1 text-xs font-medium text-red-700">{d.blocked}</div>}
                              </td>
                              <td className="num py-2 pr-2 text-right text-stone-700">
                                {d.toImport}
                                {d.alreadyImported > 0 && <div className="text-xs text-stone-400">+{d.alreadyImported} already in</div>}
                              </td>
                              <td className="py-2 pr-2 text-right">
                                <div>
                                  <Money minor={d.cash.USD} currency="USD" />
                                </div>
                                <div className="text-xs text-stone-500">
                                  <Money minor={d.cash.LBP} currency="LBP" />
                                </div>
                              </td>
                              <td className="py-2 text-right">
                                <Money minor={d.collectedEq} currency="USD" className="font-medium" />
                                <div className="text-xs text-stone-500">
                                  card <Money minor={d.card.USD} currency="USD" />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {p.problems.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold text-red-800">Rows that can&apos;t be read</h3>
                        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-red-100 bg-red-50/50 p-2 text-xs">
                          {p.problems.map((pr) => (
                            <li key={pr.row}>
                              <span className="font-semibold">Row {pr.row}:</span> {pr.problem}
                              <span className="ml-1 font-mono text-stone-500">{pr.values.join(" | ").slice(0, 120)}</span>
                            </li>
                          ))}
                        </ul>
                        {p.counts.problems > p.problems.length && (
                          <p className="mt-1 text-xs text-stone-500">and {p.counts.problems - p.problems.length} more.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {canImport && p.setup.length === 0 && (
                <Card step={3} title="Import">
                  <ActionForm
                    action={postImportAction.bind(null, imp.id)}
                    submitLabel={`Import ${p.counts.toImport} line${p.counts.toImport === 1 ? "" : "s"}`}
                    pendingLabel="Importing…"
                  >
                    <label className="flex items-start gap-2 text-sm text-stone-700">
                      <input type="checkbox" name="createMissingDays" defaultChecked className="mt-0.5 accent-brand-700" />
                      <span>
                        Open missing business days
                        <span className="block text-xs text-stone-500">
                          They start with an empty opening float; set it on the day page when you count the drawer.
                        </span>
                      </span>
                    </label>
                    <Field label="Save these settings as a POS format (optional)" hint="Next time a file with the same columns is uploaded, it's read the same way.">
                      <input name="saveAs" placeholder="e.g. Omega POS payments report" className={inputClass} />
                    </Field>
                    {p.counts.problems > 0 && (
                      <p className="text-xs text-amber-800">
                        Rows with problems won&apos;t be imported. Fix the mapping above, or import now and enter those by hand.
                      </p>
                    )}
                  </ActionForm>
                </Card>
              )}
            </div>
          </div>
        )
      )}
    </>
  );
}
