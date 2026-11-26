// Daily Close (FINCTRL v2.1, tab 1): one page for one branch and one business
// date, worked top to bottom in three steps: import the Omega sales, log
// expenses and cash movements, count the USD and LBP drawers and close.
import Link from "next/link";
import { openDayAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { BranchSelect } from "@/components/branch-select";
import { Badge, buttonClass, Card, Field, formatDate, formatTime, inputClass, Money } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext, type AppContext } from "@/server/auth";
import { findCloseDay, pickCloseDate, recentExpenseTemplates, type DayData } from "@/server/daily-close";
import { getDb } from "@/server/db";
import { getDashboard, getDay, listRates, todayIn } from "@/server/operations";
import { getImport, listImports } from "@/server/pos-import";
import { DrawerStep } from "./drawer-step";
import { EntryStep } from "./entry-step";
import { ImportStep } from "./import-step";
import { RateBadge } from "./rate-badge";

const VENUE = { restaurant: "Restaurant", cafe: "Café", pub: "Pub", other: "Venue" } as const;
const SOURCE = { market: "Market", bank: "Bank", custom: "Other" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortDate = (iso: string) => formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
const plainName = (n: string | null | undefined) => n?.replace(/\s*\(.*\)$/, "") ?? null;

function StatusBadge({ d }: { d: DayData | null }) {
  if (!d) return <Badge>Not opened</Badge>;
  if (d.day.status === "open") return <Badge tone="info">Open</Badge>;
  return d.closing?.withinTolerance ? <Badge tone="good">Closed — Balanced</Badge> : <Badge tone="bad">Closed — Flagged</Badge>;
}

/** The three steps at a glance, each a link down the page. */
function Progress({ d }: { d: DayData | null }) {
  const salesDone = Boolean(d?.hasSales);
  const entries = d ? d.expenses.filter((e) => e.status === "active").length + d.movements.length : 0;
  const closed = d?.day.status === "closed";
  const steps = [
    { n: 1, label: "Import Omega sales", done: salesDone || closed, note: salesDone ? "Sales in" : closed ? "No sales" : "Waiting" },
    { n: 2, label: "Expenses & movements", done: closed, note: `${entries} entr${entries === 1 ? "y" : "ies"}` },
    { n: 3, label: "Count & close", done: closed, note: closed ? "Locked" : d?.countsComplete ? "Counted" : "Not counted" },
  ];
  return (
    <ol className="mb-6 hidden gap-2 sm:grid sm:grid-cols-3">
      {steps.map((s) => (
        <li key={s.n}>
          <a
            href={`#step-${s.n}`}
            className="flex items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:border-stone-300"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                s.done ? "bg-emerald-600 text-white" : "bg-ink text-white"
              }`}
            >
              {s.done ? "✓" : s.n}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-stone-900">{s.label}</span>
              <span className="block truncate text-xs text-stone-500">{s.note}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** "All branches" is picked: Daily Close works on one branch, so show each branch's state for the date and let them pick. */
async function BranchBoard({ ctx, date, today }: { ctx: AppContext; date: string; today: string }) {
  const dash = await getDashboard(await getDb(), ctx.scope, date, null);
  return (
    <>
      <header className="mb-6">
        <div className="text-[13px] text-stone-500">{ctx.active.orgName} · Daily Close</div>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">Pick a branch to close</h1>
        <p className="mt-1.5 text-sm text-stone-500">Daily Close works on one branch and one business date at a time.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {dash.locations.map((l) => {
          const day = dash.todayByLocation[l.id];
          const openHere = dash.openDays.filter((o) => o.locationId === l.id);
          const overdue = openHere.filter((o) => o.businessDate < date);
          const next = `/close?date=${date}`;
          return (
            <div key={l.id} className="flex min-w-0 flex-col rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-stone-900">{l.name}</h2>
                  <div className="text-xs text-stone-500">{VENUE[l.venueType]}</div>
                </div>
                {!day ? (
                  <Badge>Not opened</Badge>
                ) : day.dayStatus === "open" ? (
                  <Badge tone="info">Open</Badge>
                ) : day.dayStatus === "closed_balanced" ? (
                  <Badge tone="good">Closed — Balanced</Badge>
                ) : (
                  <Badge tone="bad">Closed — Flagged</Badge>
                )}
              </div>
              <p className="mt-3 flex-1 text-sm text-stone-600">
                {formatDate(date, { weekday: "long", day: "numeric", month: "long" })}
                {day && day.status === "closed" && day.varianceUsd != null && day.varianceLbp != null && (
                  <>
                    {" · "}
                    <Money minor={day.varianceUsd} currency="USD" signed variance /> · <Money minor={day.varianceLbp} currency="LBP" signed variance />
                  </>
                )}
              </p>
              {overdue.length > 0 && (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  {overdue.length} earlier day{overdue.length === 1 ? "" : "s"} still open: {overdue.map((o) => shortDate(o.businessDate)).join(", ")}
                </p>
              )}
              <Link href={`/branch?location=${l.id}&next=${encodeURIComponent(next)}`} className={`${buttonClass("secondary")} mt-4`}>
                Open Daily Close
              </Link>
            </div>
          );
        })}
      </div>
      {date !== today && (
        <p className="mt-4 text-sm text-stone-500">
          Showing {formatDate(date)}.{" "}
          <Link href="/close" className="underline">
            Back to today
          </Link>
        </p>
      )}
    </>
  );
}

export default async function DailyClosePage({ searchParams }: { searchParams: Promise<{ date?: string; import?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const db = await getDb();
  const today = todayIn();
  const branch = ctx.branch;

  if (!branch) {
    if (ctx.branches.length === 0) {
      return (
        <Card>
          <p className="text-sm text-stone-600">No venues are assigned to you yet. Ask an owner to give you access to a branch.</p>
        </Card>
      );
    }
    return <BranchBoard ctx={ctx} date={pickCloseDate(sp.date, [], today)} today={today} />;
  }

  // The date: the one asked for, else the oldest day still open here, else today.
  const probe = pickCloseDate(sp.date, [], today);
  let found = await findCloseDay(db, ctx.scope, branch.id, probe);
  const date = pickCloseDate(sp.date, found.openDays.map((o) => o.date), today);
  if (date !== probe) found = await findCloseDay(db, ctx.scope, branch.id, date);

  const canSales = ctx.can("import_pos");
  const canRecord = ctx.can("record_transactions");
  const canClose = ctx.can("close_days");
  const [d, rates, imports] = await Promise.all([
    found.day ? getDay(db, ctx.scope, found.day.id) : Promise.resolve(null),
    listRates(db, ctx.scope),
    canSales ? listImports(db, ctx.scope, branch.id) : Promise.resolve([]),
  ]);
  const open = d?.day.status === "open";
  const [templates, draft] = await Promise.all([
    open && canRecord ? recentExpenseTemplates(db, ctx.scope, branch.id) : Promise.resolve([]),
    open && canSales && sp.import && UUID.test(sp.import) ? getImport(db, ctx.scope, sp.import) : Promise.resolve(null),
  ]);
  const myDraft = draft && draft.import.locationId === branch.id && draft.import.status === "draft" ? draft : null;
  const pending = imports.filter((i) => i.status === "draft" && i.id !== myDraft?.import.id);

  const active = rates[0] ?? null;
  const otherOpen = found.openDays.filter((o) => o.date !== date);
  const manager = plainName(d?.closedByName) ?? plainName(d?.openedByName) ?? plainName(ctx.user.name);

  return (
    <>
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="text-[13px] text-stone-500">
              {ctx.active.orgName} · {VENUE[branch.venueType]}
            </div>
            <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">
              {branch.name}
              <span className="font-normal text-stone-400"> · </span>
              <span className="font-normal">{formatDate(date, { weekday: "long", day: "numeric", month: "long" })}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-stone-600">
              <StatusBadge d={d} />
              <span>
                Manager: <span className="font-medium text-stone-800">{manager}</span>
              </span>
              {d?.openedByName && <span className="text-stone-500">Opened {formatTime(d.day.openedAt)}</span>}
            </div>
          </div>
          <RateBadge
            dayRate={d ? formatRate(d.rateScaled) : null}
            active={
              active
                ? {
                    text: formatRate(parseRate(active.lbpPerUsd)),
                    source: SOURCE[active.source],
                    when: formatTime(active.effectiveAt),
                    by: plainName(active.createdByName),
                  }
                : null
            }
            canEdit={ctx.can("change_rate")}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          {ctx.branches.length > 1 && (
            <div className="w-full min-w-0 sm:w-64">
              <BranchSelect
                branches={ctx.branches.map((b) => ({ id: b.id, label: `${b.name} · ${VENUE[b.venueType]}` }))}
                branchId={branch.id}
                allowAll={false}
              />
            </div>
          )}
          <form action="/close" className="flex items-end gap-2">
            <Field label="Business date">
              <input type="date" name="date" defaultValue={date} max={today} className={`${inputClass} py-1.5`} />
            </Field>
            <button className={`${buttonClass("secondary")} py-1.5`}>Go</button>
          </form>
          {date !== today && (
            <Link href={`/close?date=${today}`} className="pb-2 text-sm text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
              Today
            </Link>
          )}
          {otherOpen.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 pb-1 text-xs sm:ml-auto">
              <span className="text-stone-500">Also open here:</span>
              {otherOpen.map((o) => (
                <Link
                  key={o.id}
                  href={`/close?date=${o.date}`}
                  className={`rounded-md px-1.5 py-0.5 font-medium ${o.date < date ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-700"}`}
                >
                  {shortDate(o.date)}
                  {o.date < today && o.date < date ? " · overdue" : ""}
                </Link>
              ))}
            </div>
          )}
        </div>
      </header>

      <Progress d={d} />

      {!d ? (
        <Card title="Start the day" description="Open the drawer for this branch and date. The opening float is the cash in the drawer before service.">
          {!canClose ? (
            <p className="text-sm text-stone-600">This day hasn&apos;t been opened yet. Someone allowed to run the drawer opens it.</p>
          ) : !active ? (
            <p className="text-sm text-stone-600">Set an exchange rate first, from the rate badge above.</p>
          ) : (
            <ActionForm action={openDayAction} submitLabel="Open the day" pendingLabel="Opening…">
              <input type="hidden" name="locationId" value={branch.id} />
              <input type="hidden" name="businessDate" value={date} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Opening float (USD)" hint="Cash in the USD drawer at the start">
                  <input name="float_USD" inputMode="decimal" placeholder="0.00" className={`${inputClass} num text-right`} autoFocus />
                </Field>
                <Field label="Opening float (LBP)" hint="You can type 2m for 2,000,000">
                  <input name="float_LBP" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} />
                </Field>
              </div>
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
                {date === today ? (
                  <>
                    The day uses today&apos;s rate, <span className="num font-medium text-stone-900">{formatRate(parseRate(active.lbpPerUsd))} LBP / $</span>,
                  </>
                ) : (
                  <>A back-dated day uses the rate that was in force on its own date,</>
                )}{" "}
                and keeps it even if the rate changes later.
              </p>
            </ActionForm>
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          <ImportStep d={d} date={date} draft={myDraft} pending={pending} canImport={open && canSales} />
          <EntryStep d={d} templates={templates} canRecord={canRecord} canAdjustFloat={canClose} />
          <DrawerStep d={d} canClose={canClose} canAdjust={!open && ctx.can("post_corrections")} />
        </div>
      )}
    </>
  );
}
