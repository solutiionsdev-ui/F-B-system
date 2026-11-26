import Link from "next/link";
import { PeriodFilter, readPeriod, type PeriodSearch } from "@/components/period-filter";
import { Badge, buttonClass, Card, formatDate, Kpi, Money, PageTitle, REASON_LABELS } from "@/components/ui";
import { usdEquivalent, type Pair } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEntryOptions } from "@/server/ledgers";
import { getDashboard, getDay, todayIn, UserError } from "@/server/operations";
import { computePeriodReport, daysBetween, type DailyRow, type PeriodReport } from "@/server/reports";

const cardClass = "flex min-w-0 flex-col rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]";

function PairLines({ p }: { p: Pair }) {
  return (
    <>
      <div>
        <Money minor={p.USD} currency="USD" />
      </div>
      <div className="text-xs text-stone-500">
        <Money minor={p.LBP} currency="LBP" />
      </div>
    </>
  );
}

function Status({ d }: { d: DailyRow }) {
  if (d.dayStatus === "open") return <Badge tone="accent">Open</Badge>;
  if (d.dayStatus === "closed_balanced") return <Badge tone="good">Balanced</Badge>;
  return <Badge tone="bad">{d.closing?.reason ? `Flagged · ${REASON_LABELS[d.closing.reason]}` : "Flagged"}</Badge>;
}

export default async function ClosingPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const today = todayIn();
  const db = await getDb();
  const role = ctx.active.role;
  const canOperate = role === "owner" || role === "manager";

  const [dash, entry] = await Promise.all([getDashboard(db, ctx.scope, today), getEntryOptions(db, ctx.scope)]);
  const openDays = (await Promise.all(entry.openDays.map((d) => getDay(db, ctx.scope, d.id)))).filter((d) => d != null);
  const openLocations = new Set(openDays.map((d) => d.day.locationId));
  const notOpened = dash.locations.filter((l) => !dash.todayByLocation[l.id] && !openLocations.has(l.id));
  const closedToday = dash.locations.flatMap((l) => {
    const d = dash.todayByLocation[l.id];
    return d && d.status === "closed" ? [{ location: l, day: d }] : [];
  });

  let report: PeriodReport | null = null;
  let filterError: string | null = null;
  try {
    report = await computePeriodReport(db, ctx.scope, readPeriod(sp, today));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    filterError = e.message;
  }

  return (
    <>
      <PageTitle
        title="Cash Closing"
        subtitle="Count each drawer at the end of the day and close it. A closed day is locked; later fixes are posted as corrections on top."
        actions={
          canOperate && (
            <Link href="/days/new" className={buttonClass("primary")}>
              Open a day
            </Link>
          )
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-stone-900">Drawers</h2>
        <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
          {openDays.map((d) => {
            const late = daysBetween(d.day.businessDate, today) - 1;
            return (
              <div key={d.day.id} className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <h3 className="min-w-0 truncate font-semibold text-stone-900">{d.location.name}</h3>
                  {late > 0 ? <Badge tone="warn">{late} day{late === 1 ? "" : "s"} overdue</Badge> : <Badge tone="accent">Open</Badge>}
                </div>
                <div className="text-[13px] text-stone-500">{formatDate(d.day.businessDate, { weekday: "long", day: "numeric", month: "long" })}</div>
                <dl className="mt-3 flex-1 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-stone-500">Expected in drawer</dt>
                    <dd className="text-right font-medium text-stone-900">
                      <PairLines p={d.breakdown.expected} />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-stone-500">Collected so far</dt>
                    <dd className="text-right">
                      ≈ <Money minor={usdEquivalent(d.sales.collected, d.rateScaled)} currency="USD" />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-stone-500">Drawer count</dt>
                    <dd className="text-right">{d.countsComplete ? <Badge tone="good">Counted</Badge> : <span className="text-stone-500">Not yet</span>}</dd>
                  </div>
                </dl>
                <Link href={`/days/${d.day.id}`} className={`${buttonClass(canOperate ? "primary" : "secondary")} mt-4`}>
                  {canOperate ? "Count & close" : "View day"}
                </Link>
              </div>
            );
          })}
          {notOpened.map((l) => (
            <div key={l.id} className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 truncate font-semibold text-stone-900">{l.name}</h3>
                <Badge>Not opened</Badge>
              </div>
              <p className="mt-3 flex-1 text-sm text-stone-500">No business day today yet.</p>
              {canOperate && (
                <Link href={`/days/new?location=${l.id}`} className={`${buttonClass("secondary")} mt-4`}>
                  Open today
                </Link>
              )}
            </div>
          ))}
          {closedToday.map(({ location, day }) => (
            <div key={day.id} className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 truncate font-semibold text-stone-900">{location.name}</h3>
                {day.dayStatus === "closed_balanced" ? <Badge tone="good">Closed · balanced</Badge> : <Badge tone="bad">Closed · flagged</Badge>}
              </div>
              <p className="mt-3 flex-1 text-sm text-stone-500">
                Today is closed. Difference{" "}
                <Money minor={day.varianceEquivCents ?? 0n} currency="USD" signed variance className="font-medium" />
              </p>
              <Link href={`/days/${day.id}`} className={`${buttonClass("secondary")} mt-4`}>
                View day
              </Link>
            </div>
          ))}
        </div>
      </section>

      <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-stone-900">Closing history</h2>
      <PeriodFilter
        basePath="/closing"
        filter={report?.filter ?? readPeriod({}, today)}
        locations={dash.locations.map((l) => ({ id: l.id, name: l.name }))}
        today={today}
      />

      {filterError || !report ? (
        <Card>
          <p className="text-sm text-red-700">{filterError}</p>
        </Card>
      ) : (
        <History report={report} />
      )}
    </>
  );
}

function History({ report }: { report: PeriodReport }) {
  const c = report.cash;
  const rows = [...report.daily].reverse();
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Days closed"
          value={<span className="num">{c.status.closed}</span>}
          sub={`of ${c.status.records} business day${c.status.records === 1 ? "" : "s"} · ${c.status.open} open`}
        />
        <Kpi label="Balanced" value={<span className="num">{c.status.balanced}</span>} sub="Each currency within its allowance" />
        <Kpi
          label="Flagged"
          value={<span className={`num ${c.status.flagged ? "text-red-700" : ""}`}>{c.status.flagged}</span>}
          sub="Closed with a difference over the allowance"
        />
        <Kpi
          label="Net difference"
          value={
            <span className="block space-y-1">
              <Money minor={c.varianceAfter.USD} currency="USD" signed variance className="block" />
              <Money minor={c.varianceAfter.LBP} currency="LBP" signed variance className="block text-lg" />
            </span>
          }
          sub={c.adjustmentsEq !== 0n ? "After corrections, each currency on its own" : "No corrections posted"}
        />
      </div>

      <Card title="Every day" description="Expected is what should be in the drawer; counted is what was there. Click a day to open it.">
        {rows.length === 0 ? (
          <p className="text-sm text-stone-500">No business days in this period.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5 text-right">Expected</th>
                  <th className="px-3 py-2.5 text-right">Counted</th>
                  <th className="px-3 py-2.5 text-right">Difference</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Closed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((d) => (
                  <tr key={d.dayId} className="align-top hover:bg-stone-50/70">
                    <td className="whitespace-nowrap px-5 py-3">
                      <Link href={`/days/${d.dayId}`} className="font-medium text-stone-900 hover:underline">
                        {formatDate(d.date, { weekday: "short", day: "numeric", month: "short" })}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-stone-700">{d.locationName}</td>
                    <td className="px-3 py-3 text-right text-stone-700">{d.closing ? <PairLines p={d.closing.expected} /> : <span className="text-stone-300">—</span>}</td>
                    <td className="px-3 py-3 text-right text-stone-700">{d.closing ? <PairLines p={d.closing.counted} /> : <span className="text-stone-300">—</span>}</td>
                    <td className="px-3 py-3 text-right">
                      {d.varianceAfter ? (
                        <>
                          <div>
                            <Money minor={d.varianceAfter.USD} currency="USD" signed variance className="font-medium" />
                          </div>
                          <div className="text-xs">
                            <Money minor={d.varianceAfter.LBP} currency="LBP" signed variance />
                          </div>
                        </>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Status d={d} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-stone-500">{d.closing?.closedByName?.replace(/\s*\(.*\)$/, "") ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
