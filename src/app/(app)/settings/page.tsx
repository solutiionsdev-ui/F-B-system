import { addLocationAction, renameLocationAction, setRateAction, updateSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, formatTime, inputClass, Money, PageTitle } from "@/components/ui";
import { CATEGORY_HINTS } from "@/lib/expense-buckets";
import { formatRate, parseRate, toInputValue } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEntryOptions } from "@/server/ledgers";
import { getDashboard, listRates } from "@/server/operations";
import { getTeam, PLAN_LIMITS } from "@/server/team";

const SOURCE_LABEL = { market: "Market", bank: "Bank", custom: "House rate" } as const;

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Beirut" }).format(d);

const sectionTitle = "mb-3 text-[15px] font-semibold tracking-tight text-stone-900";

export default async function SettingsPage() {
  const ctx = await requireContext();
  const db = await getDb();
  const role = ctx.active.role;
  const owner = role === "owner";
  const canSetRate = owner || role === "manager";

  const [rates, entry, dash, team] = await Promise.all([
    listRates(db, ctx.scope),
    getEntryOptions(db, ctx.scope),
    getDashboard(db, ctx.scope),
    owner ? getTeam(db, ctx.scope) : Promise.resolve(null),
  ]);
  const current = rates[0];
  const plan = PLAN_LIMITS[dash.org.plan];

  return (
    <>
      <PageTitle title="Settings" subtitle={`${dash.org.name} · ${plan.label} plan`} />

      <h2 className={sectionTitle}>Exchange rate</h2>
      <div className={`mb-8 grid items-start gap-6 ${canSetRate ? "lg:grid-cols-[360px_minmax(0,1fr)]" : ""}`}>
        {canSetRate && (
          <Card title="Set a new rate" description="Applies to days opened from now on. Days already open keep their rate.">
            <ActionForm action={setRateAction} submitLabel="Save rate" resetOnSuccess>
              <Field label="LBP per 1 USD">
                <input name="rate" inputMode="decimal" placeholder="89,500" className={`${inputClass} num text-right`} required />
              </Field>
              <Field label="Source">
                <select name="source" className={inputClass}>
                  <option value="market">Market</option>
                  <option value="bank">Bank</option>
                  <option value="custom">House rate</option>
                </select>
              </Field>
              <Field label="Note (optional)">
                <input name="note" className={inputClass} />
              </Field>
            </ActionForm>
          </Card>
        )}

        <div className="min-w-0 space-y-6">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <div className="text-xs font-medium text-stone-500">Current rate</div>
                <div className="num mt-1 text-3xl font-semibold text-stone-900">
                  {current ? formatRate(parseRate(current.lbpPerUsd)) : "—"}
                  <span className="ml-1 text-base font-normal text-stone-500">LBP / $</span>
                </div>
                {current && (
                  <div className="mt-1 text-sm text-stone-500">
                    {SOURCE_LABEL[current.source]} · set {formatTime(current.effectiveAt)}
                    {current.createdByName && <> by {current.createdByName}</>}
                  </div>
                )}
              </div>
              <p className="max-w-sm text-[13px] leading-5 text-stone-500">
                Your restaurant&apos;s own LBP rate. Each business day keeps the rate it was opened with, so past reports never change.
              </p>
            </div>
          </Card>

          <Card title="Rate history" description="Rates are never edited or deleted. Every change is kept with who made it.">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                  <tr>
                    <th className="px-5 py-2.5">Effective</th>
                    <th className="px-3 py-2.5 text-right">LBP / $</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Note</th>
                    <th className="px-5 py-2.5">Set by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rates.map((r, i) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-5 py-2.5 text-stone-700">
                        {formatTime(r.effectiveAt)} {i === 0 && <Badge tone="good">Current</Badge>}
                      </td>
                      <td className="num px-3 py-2.5 text-right font-medium text-stone-900">{formatRate(parseRate(r.lbpPerUsd))}</td>
                      <td className="px-3 py-2.5 text-stone-600">{SOURCE_LABEL[r.source]}</td>
                      <td className="px-3 py-2.5 text-stone-600">{r.note}</td>
                      <td className="px-5 py-2.5 text-stone-600">{r.createdByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <h2 className={sectionTitle}>Restaurant</h2>
      <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Stacked in one column on medium screens; three side-by-side columns from xl. */}
        <div className="flex min-w-0 flex-col gap-6 xl:contents">
          <Card title="Group" description={owner ? undefined : "Only owners can change these."}>
            {owner ? (
              <ActionForm action={updateSettingsAction} submitLabel="Save settings">
                <Field label="Group name">
                  <input name="name" defaultValue={dash.org.name} className={inputClass} required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="USD rounding allowance">
                    <input
                      name="toleranceUsd"
                      inputMode="decimal"
                      defaultValue={toInputValue(dash.org.toleranceUsdCents, "USD")}
                      className={`${inputClass} num text-right`}
                    />
                  </Field>
                  <Field label="LBP rounding allowance">
                    <input
                      name="toleranceLbp"
                      inputMode="decimal"
                      defaultValue={toInputValue(dash.org.toleranceLbp, "LBP")}
                      className={`${inputClass} num text-right`}
                    />
                  </Field>
                </div>
                <p className="-mt-1 text-xs text-stone-500">
                  Each drawer is checked on its own. A closed day stays Balanced when each difference is within its allowance, and is
                  Flagged otherwise. Any difference, however small, still needs a written explanation. 0 means any difference flags the
                  day.
                </p>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Group name</dt>
                  <dd className="font-medium text-stone-900">{dash.org.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Rounding allowance</dt>
                  <dd>
                    ± <Money minor={dash.org.toleranceUsdCents} currency="USD" /> · ±{" "}
                    <Money minor={dash.org.toleranceLbp} currency="LBP" />
                  </dd>
                </div>
              </dl>
            )}
          </Card>

          <Card
            title="Locations"
            description={
              team
                ? `Each location has its own cash drawer and business days. ${team.usage.locations} of ${Number.isFinite(team.limits.locations) ? team.limits.locations : "unlimited"} on the ${plan.label} plan.`
                : "Each location has its own cash drawer and business days."
            }
          >
            {team ? (
              <>
                <ul className="-mx-5 -mt-4 mb-4 divide-y divide-stone-100 border-b border-stone-100">
                  {team.locations.map((l) => (
                    <li key={l.id} className="px-5 py-3">
                      <ActionForm
                        action={renameLocationAction}
                        submitLabel="Rename"
                        variant="ghost"
                        className="flex items-center gap-2"
                        footerClassName="flex-nowrap"
                      >
                        <input type="hidden" name="locationId" value={l.id} />
                        <input name="name" defaultValue={l.name} aria-label={`Name of ${l.name}`} className={`${inputClass} py-1.5`} />
                      </ActionForm>
                      <div className="mt-1 text-xs text-stone-500">
                        {l.days} business day{l.days === 1 ? "" : "s"} · added {fmtDate(l.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
                {team.usage.locations >= team.limits.locations ? (
                  <p className="text-sm text-stone-500">
                    The {plan.label} plan includes {team.limits.locations} location{team.limits.locations === 1 ? "" : "s"}. Contact us to upgrade.
                  </p>
                ) : (
                  <ActionForm action={addLocationAction} submitLabel="Add location" resetOnSuccess className="space-y-3">
                    <Field label="New location">
                      <input name="name" placeholder="e.g. Badaro" className={inputClass} required />
                    </Field>
                  </ActionForm>
                )}
              </>
            ) : (
              <ul className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
                {dash.locations.map((l) => (
                  <li key={l.id} className="px-5 py-3 font-medium text-stone-800">
                    {l.name}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Expense categories" description="The list offered when an expense is entered, in this order, for every location.">
          <ol className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
            {entry.categories.map((c, i) => (
              <li key={c.id} className="flex gap-3 px-5 py-2.5">
                <span className="num w-4 shrink-0 text-right text-stone-400">{i + 1}</span>
                <div className="min-w-0">
                  <div className="text-stone-800">{c.name}</div>
                  {CATEGORY_HINTS[c.name] && <div className="text-xs text-stone-500">{CATEGORY_HINTS[c.name]}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
