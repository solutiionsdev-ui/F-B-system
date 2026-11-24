import { switchOrgAction } from "@/app/actions";
import { Badge, buttonClass, Money, PageTitle } from "@/components/ui";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getClientOverview } from "@/server/operations";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", accountant: "Accountant" } as const;

export default async function ClientsPage() {
  const ctx = await requireContext();
  const clients = await getClientOverview(await getDb(), ctx.user.id, ctx.memberships);

  return (
    <>
      <PageTitle
        title="All clients"
        subtitle="Every restaurant group you have access to. Each group's data stays separate; this page only shows the totals."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <div key={c.orgId} className="flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-stone-900">{c.name}</h2>
                <p className="text-xs text-stone-500">
                  {c.locationCount} location{c.locationCount === 1 ? "" : "s"} · you are {ROLE_LABEL[c.role]}
                </p>
              </div>
              {c.flaggedLast7 > 0 ? <Badge tone="bad">{c.flaggedLast7} flagged</Badge> : <Badge tone="good">Clean</Badge>}
            </div>
            <dl className="mt-4 grid flex-1 grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-stone-500">Open days</dt>
                <dd className={`num font-semibold ${c.openDays > 1 ? "text-amber-700" : "text-stone-900"}`}>{c.openDays}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Closed (7d)</dt>
                <dd className="num font-semibold text-stone-900">{c.closedLast7}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Net diff. (7d)</dt>
                <dd className="font-semibold">
                  <Money minor={c.varianceLast7Cents} currency="USD" signed variance />
                </dd>
              </div>
            </dl>
            <form action={switchOrgAction} className="mt-4">
              <input type="hidden" name="orgId" value={c.orgId} />
              <button className={buttonClass(c.orgId === ctx.active.orgId ? "secondary" : "primary")}>
                {c.orgId === ctx.active.orgId ? "Currently open" : "Open"}
              </button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
