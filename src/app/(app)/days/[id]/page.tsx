import { notFound } from "next/navigation";
import { Badge, formatDate, formatTime, PageTitle } from "@/components/ui";
import { formatRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDay } from "@/server/operations";
import { SalesCard } from "./sales-card";
import { ExpensesCard } from "./expenses-card";
import { MovementsCard } from "./movements-card";
import { DrawerCard, CountCard, CloseCard, ClosedSummary } from "./drawer-cards";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DayData = NonNullable<Awaited<ReturnType<typeof getDay>>>;

export default async function DayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  const d = await getDay(await getDb(), ctx.scope, id);
  if (!d) notFound();

  const open = d.day.status === "open";
  // Each part of the day follows the permission matrix (lib/permissions.ts).
  const canSales = open && ctx.can("import_pos");
  const canRecord = open && ctx.can("record_transactions");
  const canClose = open && ctx.can("close_days");
  const canAdjust = !open && ctx.can("post_corrections");

  return (
    <>
      <PageTitle
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.location.name}
            <span className="font-normal text-stone-400">·</span>
            <span className="font-normal">{formatDate(d.day.businessDate, { weekday: "long", day: "numeric", month: "long" })}</span>
            {open ? <Badge tone="info">Open</Badge> : <Badge tone="neutral">Closed · locked</Badge>}
          </span>
        }
        subtitle={
          <>
            Rate for this day: <span className="num font-medium text-stone-700">{formatRate(d.rateScaled)} LBP / $</span> ({d.rate.source})
            {d.openedByName && <> · opened by {d.openedByName} {formatTime(d.day.openedAt)}</>}
            {d.closedByName && d.day.closedAt && <> · closed by {d.closedByName} {formatTime(d.day.closedAt)}</>}
          </>
        }
      />

      {!open && d.closing && <ClosedSummary d={d} canAdjust={canAdjust} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <SalesCard d={d} canOperate={canSales} />
          <ExpensesCard d={d} canOperate={canRecord} />
          <MovementsCard d={d} canOperate={canRecord} />
        </div>
        <div className="space-y-6 lg:sticky lg:top-20">
          {open && <DrawerCard d={d} />}
          {open && <CountCard d={d} canOperate={canClose} />}
          {open && <CloseCard d={d} canOperate={canClose} />}
          {!open && <DrawerCard d={d} />}
        </div>
      </div>
    </>
  );
}
