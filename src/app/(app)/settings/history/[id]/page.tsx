import Link from "next/link";
import { notFound } from "next/navigation";
import { discardDayImportAction, postDayImportAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, formatDate, formatTime, Money, SectionTitle } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDayImport, type DayOutcome } from "@/server/history";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OUTCOME: Record<DayOutcome, { label: string; tone: "good" | "bad" | "info" | "neutral" }> = {
  close_balanced: { label: "Closes — Balanced", tone: "good" },
  close_flagged: { label: "Closes — Flagged", tone: "bad" },
  open: { label: "Left open", tone: "info" },
  skip: { label: "Skipped", tone: "neutral" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <div className="text-[11px] font-medium text-stone-500">{label}</div>
      <div className={`num text-lg font-semibold ${tone ?? "text-stone-900"}`}>{value}</div>
    </div>
  );
}

export default async function PastDaysPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  if (ctx.active.role !== "owner") notFound();
  const d = await getDayImport(await getDb(), ctx.scope, id);
  if (!d) notFound();
  const imp = d.import;
  const summary = imp.summary as null | { closedBalanced: number; closedFlagged: number; leftOpen: number; skipped: number; expenses: number; movements: number };
  const errors = d.issues.filter((i) => i.level === "error");
  const others = d.issues.filter((i) => i.level !== "error");
  const postable = d.days.filter((x) => x.outcome !== "skip").length;

  return (
    <>
      <SectionTitle
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
            <Link href="/settings/history" className="underline">
              all imports
            </Link>
          </>
        }
      />

      {imp.status === "posted" && summary && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          Posted {imp.postedAt && formatTime(imp.postedAt)}: {plural(summary.closedBalanced, "day")} closed balanced, {summary.closedFlagged} closed flagged,{" "}
          {summary.leftOpen} left open, {summary.skipped} skipped; {plural(summary.expenses, "expense")} and {plural(summary.movements, "cash movement")}{" "}
          recorded. They now show in{" "}
          <Link href="/performance" className="font-medium underline">
            Performance
          </Link>{" "}
          and{" "}
          <Link href="/close" className="font-medium underline">
            Daily Close
          </Link>
          .
        </div>
      )}

      {imp.status === "draft" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Close balanced" value={d.counts.close_balanced} tone="text-emerald-700" />
            <Stat label="Close flagged" value={d.counts.close_flagged} tone={d.counts.close_flagged ? "text-red-700" : undefined} />
            <Stat label="Left open" value={d.counts.open} />
            <Stat label="Skipped" value={d.counts.skip} tone={d.counts.skip ? "text-amber-700" : undefined} />
          </div>

          <Card className="mb-6" title="What posting will do">
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
              <li>Each day is opened with its float and rate, its sales, expenses and cash movements are recorded, and its count is saved.</li>
              <li>Days with a count are closed and locked, exactly as in Daily Close; a difference keeps its written explanation. Days without a count stay open.</li>
              <li>Skipped days aren&apos;t touched, and nothing already in FINCTRL changes. Everything is saved together, or nothing is.</li>
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
              {postable > 0 && (
                <ActionForm
                  action={postDayImportAction.bind(null, imp.id)}
                  submitLabel={`Import ${postable} day${postable === 1 ? "" : "s"}`}
                  pendingLabel="Importing…"
                  className="contents"
                  confirmText={`Import ${postable} day${postable === 1 ? "" : "s"}? Closed days are locked like any other; later fixes are corrections.`}
                >
                  <span />
                </ActionForm>
              )}
              <ActionForm action={discardDayImportAction.bind(null, imp.id)} submitLabel="Discard" variant="ghost" className="contents" confirmText="Discard this workbook? Nothing from it is saved.">
                <span />
              </ActionForm>
            </div>
          </Card>
        </>
      )}

      {(errors.length > 0 || others.length > 0) && (
        <div className="mb-6 space-y-3">
          {errors.length > 0 && (
            <details open className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-900">
              <summary className="cursor-pointer font-semibold">Rows skipped · {errors.length}</summary>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {errors.map((i, n) => (
                  <li key={n}>
                    <span className="font-medium">{i.subject}</span>
                    {i.row != null && <span className="text-xs opacity-70"> ({i.sheet} row {i.row})</span>}: {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {others.length > 0 && (
            <details className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
              <summary className="cursor-pointer font-semibold">Notes · {others.length}</summary>
              <ul className="mt-2 space-y-1">
                {others.map((i, n) => (
                  <li key={n}>
                    <span className="font-medium">{i.subject}</span>: {i.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {imp.status === "draft" && (
        <Card title={`Days · ${d.days.length}`} description="Expected is worked out the same way as in Daily Close: opening float + cash sales − cash refunds − expenses paid from the drawer − cash movements, in each currency on its own.">
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Day</th>
                  <th className="px-3 py-2.5 text-right">Collected</th>
                  <th className="px-3 py-2.5 text-right">Expected in drawer</th>
                  <th className="px-3 py-2.5 text-right">Counted</th>
                  <th className="px-3 py-2.5 text-right">Difference</th>
                  <th className="px-5 py-2.5">Becomes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {d.days.map((x) => (
                  <tr key={x.key} className="align-top">
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-stone-900">{formatDate(x.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
                      <div className="text-xs text-stone-500">
                        {x.branch} · {x.expenses} expense{x.expenses === 1 ? "" : "s"}
                        {x.movements ? ` · ${x.movements} movement${x.movements === 1 ? "" : "s"}` : ""}
                        {x.rate && ` · rate ${x.rate}`}
                      </div>
                      {x.rateNote && <div className="text-xs text-amber-700">{x.rateNote}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <Money minor={x.collected.USD} currency="USD" />
                      <div className="text-xs text-stone-500">
                        <Money minor={x.collected.LBP} currency="LBP" />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <Money minor={x.expected.USD} currency="USD" />
                      <div className="text-xs text-stone-500">
                        <Money minor={x.expected.LBP} currency="LBP" />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {x.counted ? (
                        <>
                          <Money minor={x.counted.USD} currency="USD" />
                          <div className="text-xs text-stone-500">
                            <Money minor={x.counted.LBP} currency="LBP" />
                          </div>
                        </>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {x.variance ? (
                        <>
                          <Money minor={x.variance.USD} currency="USD" signed variance />
                          <div className="text-xs">
                            <Money minor={x.variance.LBP} currency="LBP" signed variance />
                          </div>
                        </>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={OUTCOME[x.outcome].tone}>{OUTCOME[x.outcome].label}</Badge>
                      {x.reasons.map((r) => (
                        <div key={r} className="mt-1 max-w-64 text-xs text-stone-500">
                          {r}
                        </div>
                      ))}
                    </td>
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
