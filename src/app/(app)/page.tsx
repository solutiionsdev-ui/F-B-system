import Link from "next/link";
import { Badge, buttonClass, Card, formatDate, Money, PageTitle, REASON_LABELS } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/operations";

export default async function TodayPage() {
  const ctx = await requireContext();
  const data = await getDashboard(await getDb(), ctx.scope);
  const canOperate = ctx.active.role !== "accountant";
  const staleOpen = data.openDays.filter((d) => d.businessDate !== data.today);

  return (
    <>
      <PageTitle
        title={data.org.name}
        subtitle={formatDate(data.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <Link href="/rates" className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-right shadow-xs hover:border-stone-300">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Today&apos;s rate</div>
            <div className="num text-lg font-semibold text-stone-900">
              {data.rate ? `${formatRate(parseRate(data.rate.lbpPerUsd))} LBP / $` : "Not set"}
            </div>
          </Link>
        }
      />

      {!data.rate && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set an exchange rate before opening the first day.{" "}
          <Link href="/rates" className="font-medium underline">
            Set the rate
          </Link>
        </div>
      )}

      {staleOpen.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-medium">Still open from earlier:</span>{" "}
          {staleOpen.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link href={`/days/${d.id}`} className="underline">
                {d.locationName}, {formatDate(d.businessDate, { day: "numeric", month: "short" })}
              </Link>
            </span>
          ))}
          . Close these so the numbers are final.
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.locations.map((loc) => {
          const day = data.todayByLocation[loc.id];
          return (
            <div key={loc.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-stone-900">{loc.name}</h2>
                {!day && <Badge>Not opened</Badge>}
                {day?.status === "open" && <Badge tone="info">Open</Badge>}
                {day?.status === "closed" &&
                  (day.withinTolerance ? <Badge tone="good">Closed · balanced</Badge> : <Badge tone="bad">Closed · flagged</Badge>)}
              </div>
              <div className="mt-3 flex-1 text-sm text-stone-600">
                {!day && "No business day for today yet."}
                {day?.status === "open" && "Sales and expenses are being recorded. Count the cash to close."}
                {day?.status === "closed" && (
                  <>
                    Difference{" "}
                    <Money minor={day.varianceEquivCents ?? 0n} currency="USD" signed variance className="font-medium" />
                    {day.closedByName && <> · closed by {day.closedByName}</>}
                  </>
                )}
              </div>
              <div className="mt-4">
                {!day && canOperate && (
                  <Link href={`/days/new?location=${loc.id}`} className={buttonClass("primary")}>
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

      <Card title="Recent days" description="Each closed day is locked. Differences are shown in USD at that day's rate.">
        {data.recent.length === 0 ? (
          <p className="text-sm text-stone-500">No business days yet.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Location</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Difference</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-5 py-2.5">Closed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.recent.map((d) => (
                  <tr key={d.id} className="hover:bg-stone-50">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <Link href={`/days/${d.id}`} className="font-medium text-stone-900 hover:underline">
                        {formatDate(d.businessDate)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{d.locationName}</td>
                    <td className="px-3 py-2.5">
                      {d.status === "open" ? (
                        <Badge tone="info">Open</Badge>
                      ) : d.withinTolerance ? (
                        <Badge tone="good">Balanced</Badge>
                      ) : (
                        <Badge tone="bad">Flagged</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {d.varianceEquivCents != null ? (
                        <Money minor={d.varianceEquivCents} currency="USD" signed variance />
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-stone-600">{d.varianceReason ? REASON_LABELS[d.varianceReason] : ""}</td>
                    <td className="px-5 py-2.5 text-stone-600">{d.closedByName ?? ""}</td>
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
