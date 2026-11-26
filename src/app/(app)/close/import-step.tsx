// Daily Close, step 1: import the Omega sales. Upload reads the file into a
// draft; the preview shows every total; posting needs an explicit Confirm.
// An unrecognised format stops here and asks for the columns to be matched:
// FINCTRL never guesses a mapping.
import Link from "next/link";
import { confirmCloseImportAction, discardCloseImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, formatDate } from "@/components/ui";
import { CURRENCIES, formatAmount, type Pair } from "@/lib/money";
import type { DayData } from "@/server/daily-close";
import type { getImport, listImports } from "@/server/pos-import";
import { Dropzone } from "./dropzone";
import { ManualSalesForm, SalesSummary } from "./sales";

type Draft = NonNullable<Awaited<ReturnType<typeof getImport>>>;
type ImportRow = Awaited<ReturnType<typeof listImports>>[number];

const pairText = (p: Pair) =>
  CURRENCIES.filter((c) => p[c] !== 0n)
    .map((c) => formatAmount(p[c], c))
    .join(" + ") || formatAmount(0n, "USD");

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-medium text-stone-500">{label}</div>
      <div className={`num text-lg font-semibold ${tone ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

function Preview({ draft, date, canImport }: { draft: Draft; date: string; canImport: boolean }) {
  const p = draft.preview!;
  const imp = draft.import;
  const format = draft.profiles.find((f) => f.id === imp.profileId) ?? null;
  const dates = p.days.map((x) => x.date);
  const wrongDate = dates.length !== 1 || dates[0] !== date;
  const blocked = p.days.find((x) => x.blocked)?.blocked ?? null;
  const t = p.totals;
  const apps: Pair = { USD: t.byTender.toters.USD + t.byTender.noknok.USD, LBP: t.byTender.toters.LBP + t.byTender.noknok.LBP };
  const matches = CURRENCIES.every((c) => p.check.file[c] === p.check.posting[c]);
  const stop = !format ? "format" : p.setup.length ? "setup" : wrongDate ? "date" : blocked ? "blocked" : p.counts.toImport === 0 ? "nothing" : null;
  const replaces = p.days.some((x) => x.replacesManual);

  const lines: [string, Pair, boolean?][] = [
    ["Cash (USD)", { USD: t.byTender.cash.USD, LBP: 0n }],
    ["Cash (LBP)", { USD: 0n, LBP: t.byTender.cash.LBP }],
    ["Card", t.byTender.card, true],
    ["Toters", t.byTender.toters, true],
    ["NokNok", t.byTender.noknok, true],
    ["Delivery apps combined", apps, true],
    ...(t.byTender.other.USD || t.byTender.other.LBP ? ([["Other payments", t.byTender.other, true]] as [string, Pair, boolean][]) : []),
    ["Discounts", t.discounts],
    ["Voids", t.voids],
    ...(t.refunds.USD || t.refunds.LBP ? ([["Refunds", t.refunds]] as [string, Pair][]) : []),
    ["VAT", t.tax],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="font-medium text-stone-900">{imp.fileName}</span>
          <span className="text-stone-500">
            {" "}
            · {imp.rowCount} rows · {formatDate(dates[0] ?? date, { weekday: "short", day: "numeric", month: "short" })}
            {dates.length > 1 && ` to ${formatDate(dates.at(-1)!, { day: "numeric", month: "short" })}`}
          </span>
        </span>
        {format ? <Badge tone="good">Recognised: {format.name}</Badge> : <Badge tone="warn">Unknown format</Badge>}
      </div>

      {stop === "format" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          These columns don&apos;t match a saved POS format, so FINCTRL won&apos;t guess how to read them.{" "}
          <Link href={`/import/${imp.id}`} className="font-medium underline">
            Match the columns
          </Link>{" "}
          once and save it as a format; files like this are then read the same way every night.
        </div>
      )}
      {stop === "setup" && (
        <ul className="list-disc space-y-1 rounded-lg border border-red-100 bg-red-50/60 py-2 pl-8 pr-3 text-sm text-red-800">
          {p.setup.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {stop === "date" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          This file covers {dates.map((x) => formatDate(x, { day: "numeric", month: "short" })).join(", ")}, not{" "}
          {formatDate(date, { day: "numeric", month: "short" })}. Pick that date above, or{" "}
          <Link href={`/import/${imp.id}`} className="font-medium underline">
            review it on the full import page
          </Link>{" "}
          for a file covering several days.
        </div>
      )}
      {stop === "blocked" && <div className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5 text-sm text-red-800">{blocked}</div>}
      {stop === "nothing" && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-700">
          Every row in this file is already imported. There is nothing new to post.
        </div>
      )}
      {replaces && stop === null && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          This day already has totals typed in from the Z report (shown above). Confirming replaces them with this file, so the sales are
          counted once. The typed-in lines stay in the audit trail with your name.
        </div>
      )}
      {draft.sameFilePosted.length > 0 && (
        <p className="text-xs font-medium text-amber-800">
          This exact file was imported before ({draft.sameFilePosted.map((f) => f.locationName).join(", ")}). Rows already in FINCTRL are skipped.
        </p>
      )}
      {p.days[0]?.otherImportLines ? (
        <p className="text-xs font-medium text-amber-800">
          This day already has {p.days[0].otherImportLines} imported lines from a different file. Check it isn&apos;t the same evening exported twice.
        </p>
      ) : null}

      {p.setup.length === 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Accepted rows" value={p.counts.toImport} tone="text-emerald-700" />
            <Stat label="Rejected rows" value={p.counts.problems} tone={p.counts.problems ? "text-red-700" : undefined} />
            <Stat label="Duplicates" value={p.counts.duplicatesInFile + p.counts.alreadyImported} />
            <Stat label="Skipped" value={p.counts.skipped + p.counts.blocked} />
          </div>

          <dl className="grid gap-x-6 gap-y-1 rounded-xl border border-stone-200 p-3 text-sm sm:grid-cols-2">
            {lines.map(([label, pair, notDrawer]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="text-stone-600">
                  {label}
                  {notDrawer && <span className="ml-1 text-[10.5px] text-stone-400">not drawer cash</span>}
                </dt>
                <dd className="num text-right font-medium text-stone-900">
                  {pair.USD === 0n && pair.LBP === 0n ? <span className="text-stone-300">{formatAmount(0n, "USD")}</span> : pairText(pair)}
                </dd>
              </div>
            ))}
          </dl>

          <div className={`rounded-lg px-3 py-2.5 text-sm ${matches ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                Source total <span className="text-xs opacity-75">(every payment row in the file, less refunds)</span>
              </span>
              <span className="num font-medium">{pairText(p.check.file)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                FINCTRL total <span className="text-xs opacity-75">(what will be posted)</span>
              </span>
              <span className="num font-medium">{pairText(p.check.posting)}</span>
            </div>
            <div className="mt-1 text-xs opacity-80">
              {matches
                ? "They match. Each currency is kept on its own; nothing is converted before posting."
                : "They differ by rows already imported or that can't be posted, counted above. Only the FINCTRL total is posted."}{" "}
              Discounts, voids and VAT are shown for checking and are not deducted again.
            </div>
          </div>

          {p.problems.length > 0 && (
            <details className="rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-red-800">
                {p.counts.problems} row{p.counts.problems === 1 ? "" : "s"} can&apos;t be read and won&apos;t be posted
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {p.problems.slice(0, 20).map((pr) => (
                  <li key={pr.row}>
                    <span className="font-semibold">Row {pr.row}:</span> {pr.problem}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {canImport && (
        <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3">
          {stop === null ? (
            <ActionForm
              action={confirmCloseImportAction.bind(null, imp.id, date)}
              submitLabel={`${replaces ? "Replace typed-in totals and import" : "Confirm import"} · ${p.counts.toImport} line${p.counts.toImport === 1 ? "" : "s"}`}
              pendingLabel="Posting…"
              className="contents"
              confirmText={replaces ? "Replace the typed-in totals for this day with this file? The removed lines are kept in the audit trail." : undefined}
            >
              <span className="sr-only">Posts the accepted rows onto this business day.</span>
            </ActionForm>
          ) : null}
          <ActionForm
            action={discardCloseImportAction.bind(null, imp.id, date)}
            submitLabel="Discard this file"
            pendingLabel="Discarding…"
            variant="ghost"
            className="contents"
            confirmText={`Discard ${imp.fileName}? Nothing has been imported from it.`}
          >
            <span />
          </ActionForm>
          <Link href={`/import/${imp.id}`} className="text-xs text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
            Column mapping and full preview
          </Link>
        </div>
      )}
      <p className="text-xs text-stone-500">Nothing is posted until you confirm. The file, its rows, the format used and who uploaded it are kept with the import.</p>
    </div>
  );
}

export function ImportStep({
  d,
  date,
  draft,
  pending,
  canImport,
}: {
  d: DayData;
  date: string;
  draft: Draft | null;
  /** Unposted uploads for this branch. */
  pending: ImportRow[];
  canImport: boolean;
}) {
  const open = d.day.status === "open";
  const importIds = [...new Set(d.lines.map((l) => l.importId).filter((x): x is string => Boolean(x)))];
  const imported = importIds.length > 0;
  const manual = d.hasSales && !imported;
  const status = imported ? (
    <Badge tone="good">Imported · {d.lines.length} lines</Badge>
  ) : manual ? (
    <Badge tone="good">Typed in from the Z report</Badge>
  ) : draft?.preview ? (
    <Badge tone="warn">Preview · not posted</Badge>
  ) : (
    <Badge>Not yet</Badge>
  );

  return (
    <Card
      id="step-1"
      step={1}
      title="Import Omega sales"
      description="The Omega sales and payment export for this branch and date: CSV, Excel, PDF or a Google Sheet. Preview it, then confirm."
      actions={status}
    >
      <div className="space-y-4">
        {d.hasSales && (
          <div className="space-y-3">
            {imported && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
                From{" "}
                {importIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link href={`/import/${id}`} className="font-medium underline">
                      {importIds.length > 1 ? `import ${i + 1}` : "this import"}
                    </Link>
                  </span>
                ))}
                . To correct it, undo the import there while the day is open.
              </p>
            )}
            <SalesSummary d={d} />
          </div>
        )}

        {!open ? (
          !d.hasSales && <p className="text-sm text-stone-500">No sales were recorded for this day.</p>
        ) : draft?.preview && draft.import.status === "draft" ? (
          <div className={d.hasSales ? "border-t border-stone-100 pt-4" : ""}>
            <Preview draft={draft} date={date} canImport={canImport} />
          </div>
        ) : !canImport ? (
          !d.hasSales && <p className="text-sm text-stone-500">No sales yet. Someone allowed to import POS sales posts them here.</p>
        ) : (
          <div className={`space-y-4 ${d.hasSales ? "border-t border-stone-100 pt-4" : ""}`}>
            {pending.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Uploaded but not posted:{" "}
                {pending.slice(0, 3).map((i, n) => (
                  <span key={i.id}>
                    {n > 0 && ", "}
                    <Link href={`/close?date=${date}&import=${i.id}#step-1`} className="font-medium underline">
                      {i.fileName}
                    </Link>
                  </span>
                ))}
                . Open it to preview and confirm, or discard it.
              </div>
            )}
            {imported ? (
              <details className="rounded-lg border border-stone-200 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium text-stone-700">Import another Omega file for this day</summary>
                <p className="mt-2 text-xs text-stone-500">Rows already imported are recognised and skipped, so the same sale is never counted twice.</p>
                <div className="mt-3">
                  <Dropzone locationId={d.day.locationId} date={date} />
                </div>
              </details>
            ) : (
              <>
                {manual && (
                  <div>
                    <h3 className="text-sm font-semibold text-stone-900">Import the Omega export instead</h3>
                    <p className="mt-0.5 text-[13px] text-stone-500">
                      These totals were typed in from the Z report. Importing the export replaces them after you check the preview.
                    </p>
                  </div>
                )}
                <Dropzone locationId={d.day.locationId} date={date} />
                <details className="rounded-lg border border-stone-200 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium text-stone-700">
                    {manual ? "Edit the typed-in totals instead" : "No export tonight? Type the Z-report totals instead"}
                  </summary>
                  <div className="mt-3">
                    <ManualSalesForm d={d} />
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
