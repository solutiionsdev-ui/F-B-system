import { addLocationAction, setLocationStatusAction, updateLocationAction, updateSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, inputClass, Money, SectionTitle } from "@/components/ui";
import { CATEGORY_HINTS } from "@/lib/expense-buckets";
import { formatScaled, toInputValue } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEntryOptions } from "@/server/ledgers";
import { getDashboard } from "@/server/operations";
import { getTeam, PLAN_LIMITS, VENUE_TYPES } from "@/server/team";

const VENUE_LABEL = Object.fromEntries(VENUE_TYPES.map((v) => [v.value, v.label])) as Record<string, string>;
/** When the business day ends: sales before this hour count for the previous day. */
const CUTOFF_HOURS = Array.from({ length: 12 }, (_, h) => ({ value: h, label: h === 0 ? "Midnight" : `${String(h).padStart(2, "0")}:00` }));

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Beirut" }).format(d);

const sectionTitle = "mb-3 text-[15px] font-semibold tracking-tight text-stone-900";

export default async function SettingsPage() {
  const ctx = await requireContext();
  const db = await getDb();
  const owner = ctx.can("manage_team");

  const [entry, dash, team] = await Promise.all([
    getEntryOptions(db, ctx.scope),
    getDashboard(db, ctx.scope),
    owner ? getTeam(db, ctx.scope) : Promise.resolve(null),
  ]);
  const plan = PLAN_LIMITS[dash.org.plan];

  return (
    <>
      <SectionTitle
        title="Business"
        subtitle={`${dash.org.name} · ${plan.label} plan · locations, rounding allowance and expense categories. The rate is changed from the badge on Daily Close.`}
      />

      <h2 className={sectionTitle}>Business</h2>
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
                <Field
                  label="Cost alert (%)"
                  hint="Performance shows a red alert when running costs (all expenses: salaries, food, electricity, rent and the rest) take this much more of sales than in the 30 days before. 5 means a share of 60% rising to 63%."
                >
                  <input
                    name="costAlert"
                    inputMode="decimal"
                    defaultValue={formatScaled(BigInt(dash.org.costAlertBp), 2)}
                    className={`${inputClass} num w-28 text-right`}
                  />
                </Field>
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
                    <li key={l.id} className={`space-y-2 px-5 py-4 ${l.status === "archived" ? "bg-stone-50/70" : ""}`}>
                      <ActionForm action={updateLocationAction} submitLabel="Save" variant="secondary" className="space-y-2">
                        <input type="hidden" name="locationId" value={l.id} />
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Name" className="col-span-2">
                            <input name="name" defaultValue={l.name} className={`${inputClass} py-1.5`} required />
                          </Field>
                          <Field label="Type">
                            <select name="venueType" defaultValue={l.venueType} className={`${inputClass} py-1.5`}>
                              {VENUE_TYPES.map((v) => (
                                <option key={v.value} value={v.value}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Business day ends">
                            <select name="dayCutoffHour" defaultValue={String(l.dayCutoffHour)} className={`${inputClass} py-1.5`}>
                              {CUTOFF_HOURS.map((h) => (
                                <option key={h.value} value={h.value}>
                                  {h.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      </ActionForm>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                        <span>
                          {l.status === "archived" && (
                            <>
                              <Badge>Archived</Badge>{" "}
                            </>
                          )}
                          {l.days} business day{l.days === 1 ? "" : "s"} · added {fmtDate(l.createdAt)}
                        </span>
                        <ActionForm
                          action={setLocationStatusAction}
                          submitLabel={l.status === "archived" ? "Restore" : "Archive"}
                          variant="ghost"
                          confirmText={
                            l.status === "archived"
                              ? undefined
                              : `Archive ${l.name}? It disappears from day-to-day screens; its history stays in reports. You can restore it later.`
                          }
                        >
                          <input type="hidden" name="locationId" value={l.id} />
                          <input type="hidden" name="status" value={l.status === "archived" ? "active" : "archived"} />
                        </ActionForm>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mb-4 text-xs text-stone-500">
                  Sales before the business day&apos;s end time count for the previous day. New POS imports for a location start from its
                  end time.
                </p>
                {team.usage.locations >= team.limits.locations ? (
                  <p className="text-sm text-stone-500">
                    The {plan.label} plan includes {team.limits.locations} location{team.limits.locations === 1 ? "" : "s"}. Contact us to upgrade.
                  </p>
                ) : (
                  <ActionForm action={addLocationAction} submitLabel="Add location" resetOnSuccess className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="New location">
                        <input name="name" placeholder="e.g. Badaro Kitchen" className={inputClass} required />
                      </Field>
                      <Field label="Type">
                        <select name="venueType" defaultValue="restaurant" className={inputClass}>
                          {VENUE_TYPES.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </ActionForm>
                )}
              </>
            ) : (
              <ul className="-mx-5 -my-4 divide-y divide-stone-100 text-sm">
                {dash.locations.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 px-5 py-3">
                    <span className="font-medium text-stone-800">{l.name}</span>
                    <span className="text-xs text-stone-500">
                      {VENUE_LABEL[l.venueType]} · day ends {CUTOFF_HOURS[l.dayCutoffHour]?.label ?? `${l.dayCutoffHour}:00`}
                    </span>
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
