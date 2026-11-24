import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { Icon } from "@/components/icons";
import { Badge, buttonClass, Card, Delta, formatDate, formatTime, Money, REASON_LABELS, type Tone } from "@/components/ui";
import { formatRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getToday, greeting, type AttentionItem } from "@/server/today";

function StatTile({ label, value, chip, sub, chart }: { label: string; value: ReactNode; chip?: ReactNode; sub?: ReactNode; chart?: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] text-stone-500">{label}</span>
        {chip}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 truncate text-[26px] font-semibold leading-none tracking-tight text-stone-900">{value}</div>
        {chart}
      </div>
      {sub && <div className="mt-2.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

const ICON_TONE: Record<AttentionItem["tone"], string> = {
  bad: "bg-red-50 text-red-600",
  warn: "bg-amber-50 text-amber-600",
  accent: "bg-brand-50 text-brand-600",
  neutral: "bg-stone-100 text-stone-500",
  info: "bg-sky-50 text-sky-600",
};

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link href={item.href} className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-stone-50">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ICON_TONE[item.tone]}`}>
          <Icon name={item.icon} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-stone-900">{item.title}</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-stone-500">{item.detail}</span>
          <span className="mt-1.5 block">
            <Badge tone={item.tone as Tone}>{item.pill}</Badge>
          </span>
        </span>
        <Icon name="arrow" size={16} className="mt-2 text-stone-300 transition-colors group-hover:text-stone-500" />
      </Link>
    </li>
  );
}

const RATE_SOURCE = { market: "Market", bank: "Bank", custom: "House rate" } as const;

export default async function TodayPage() {
  const ctx = await requireContext();
  const data = await getToday(await getDb(), ctx.scope);
  const { dash, kpis } = data;
  const canOperate = ctx.active.role !== "accountant";
  const firstName = ctx.user.name.replace(/\s*\(.*\)$/, "").split(/\s+/)[0];
  const needCount = data.needs.length;

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-stone-500">
            {formatDate(data.today, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
            {needCount === 0
              ? "nothing needs you right now"
              : `${needCount} thing${needCount === 1 ? " needs" : "s need"} you`}
          </p>
        </div>
        {canOperate && (
          <div className="flex flex-wrap gap-2">
            <Link href="/import" className={buttonClass("secondary")}>
              <Icon name="import" size={16} /> Import POS file
            </Link>
            <Link href="/days/new" className={buttonClass("primary")}>
              Open a day
            </Link>
          </div>
        )}
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Collected today"
          value={<Money minor={kpis.collected.value} currency="USD" />}
          chip={<Delta pct={kpis.collected.delta} label={kpis.compareLabel} />}
          chart={<Sparkline values={kpis.collected.spark} label="Collected per day, last 14 days" />}
          sub={`All locations, in USD · ${kpis.compareLabel}`}
        />
        <StatTile
          label="Expenses today"
          value={<Money minor={kpis.expenses.value} currency="USD" />}
          chip={<Delta pct={kpis.expenses.delta} upIsGood={false} label={kpis.compareLabel} />}
          chart={<Sparkline values={kpis.expenses.spark} label="Expenses per day, last 14 days" />}
          sub="Every payment method"
        />
        <StatTile
          label="Cash difference · 7 days"
          value={<Money minor={kpis.difference.value} currency="USD" signed variance />}
          chip={
            kpis.difference.flagged ? (
              <Badge tone="bad">{kpis.difference.flagged} flagged</Badge>
            ) : (
              <Badge tone="good">Balanced</Badge>
            )
          }
          sub={`${kpis.difference.closed} days closed, after corrections`}
        />
        <Link href="/rates" className="group block min-w-0">
          <StatTile
            label="Exchange rate"
            value={
              data.rate ? (
                <span className="num">
                  {formatRate(data.rate.scaled)}
                  <span className="ml-1 text-sm font-normal text-stone-500">LBP/$</span>
                </span>
              ) : (
                "Not set"
              )
            }
            chip={<Icon name="arrow" size={16} className="text-stone-300 group-hover:text-stone-500" />}
            sub={data.rate ? `${RATE_SOURCE[data.rate.source]} · set ${formatTime(data.rate.at)}` : "Set it before opening a day"}
          />
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-stone-900">Locations today</h2>
            <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
              {dash.locations.map((loc) => {
                const day = dash.todayByLocation[loc.id];
                const collected = data.collectedToday[loc.id];
                return (
                  <div
                    key={loc.id}
                    className="flex flex-col rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <h3 className="min-w-0 truncate font-semibold text-stone-900">{loc.name}</h3>
                      {!day && <Badge>Not opened</Badge>}
                      {day?.status === "open" && <Badge tone="accent">Open</Badge>}
                      {day?.status === "closed" &&
                        (day.withinTolerance ? <Badge tone="good">Balanced</Badge> : <Badge tone="bad">Flagged</Badge>)}
                    </div>
                    <div className="mt-3 flex-1">
                      {day ? (
                        <>
                          <div className="text-xs text-stone-500">Collected</div>
                          <div className="text-xl font-semibold tracking-tight text-stone-900">
                            <Money minor={collected ?? 0n} currency="USD" />
                          </div>
                          {day.status === "closed" && (
                            <div className="mt-1 text-xs text-stone-500">
                              Difference{" "}
                              <Money minor={day.varianceEquivCents ?? 0n} currency="USD" signed variance className="font-medium" />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-stone-500">No business day yet.</p>
                      )}
                    </div>
                    <div className="mt-4">
                      {!day && canOperate && (
                        <Link href={`/days/new?location=${loc.id}`} className={buttonClass("secondary")}>
                          Open today
                        </Link>
                      )}
                      {day && (
                        <Link href={`/days/${day.id}`} className={buttonClass(day.status === "open" ? "primary" : "secondary")}>
                          {day.status === "open" ? "Continue closing" : "View day"}
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <Card title="Recent days" description="Closed days are locked. Differences in USD at that day's rate.">
            {dash.recent.length === 0 ? (
              <p className="text-sm text-stone-500">No business days yet.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-stone-100 bg-stone-50/60 text-left text-xs font-medium text-stone-500">
                    <tr>
                      <th className="px-5 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Location</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Difference</th>
                      <th className="px-5 py-2.5">Closed by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {dash.recent.slice(0, 12).map((d) => (
                      <tr key={d.id} className="hover:bg-stone-50/70">
                        <td className="whitespace-nowrap px-5 py-3">
                          <Link href={`/days/${d.id}`} className="font-medium text-stone-900 hover:underline">
                            {formatDate(d.businessDate, { weekday: "short", day: "numeric", month: "short" })}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-stone-700">{d.locationName}</td>
                        <td className="px-3 py-3">
                          {d.status === "open" ? (
                            <Badge tone="accent">Open</Badge>
                          ) : d.withinTolerance ? (
                            <Badge tone="good">Balanced</Badge>
                          ) : (
                            <Badge tone="bad">{d.varianceReason ? REASON_LABELS[d.varianceReason] : "Flagged"}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {d.varianceEquivCents != null ? (
                            <Money minor={d.varianceEquivCents} currency="USD" signed variance />
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-stone-500">{d.closedByName?.replace(/\s*\(.*\)$/, "") ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <section className="min-w-0 rounded-2xl border border-stone-200/80 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] lg:sticky lg:top-6">
          <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">Needs you</h2>
              {needCount > 0 && (
                <span className="num rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">{needCount}</span>
              )}
            </div>
            <span className="text-xs text-stone-400">Most urgent first</span>
          </header>
          {needCount === 0 ? (
            <div className="flex items-center gap-3 px-5 py-4 text-sm text-stone-600">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Icon name="check" size={16} />
              </span>
              All caught up. Every day is closed and balanced.
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {data.needs.map((i) => (
                <AttentionRow key={i.key} item={i} />
              ))}
            </ul>
          )}
          {data.info.length > 0 ? (
            <>
              <div className="border-t border-stone-100 px-5 pb-1 pt-4 text-xs font-medium text-stone-400">For your information</div>
              <ul className="divide-y divide-stone-100 pb-2">
                {data.info.map((i) => (
                  <AttentionRow key={i.key} item={i} />
                ))}
              </ul>
            </>
          ) : (
            <div className="pb-2" />
          )}
        </section>
      </div>
    </>
  );
}
