import { BranchSelect } from "@/components/branch-select";
import { SubNav } from "@/components/sub-nav";
import type { AppContext } from "@/server/auth";

const VENUE = { restaurant: "Restaurant", cafe: "Café", pub: "Pub", other: "Venue" } as const;

/** The tab's own header: title, branch and the two views (overview and ledger). */
export function PerformanceHeader({ ctx }: { ctx: AppContext }) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-stone-500">{ctx.active.orgName} · read-only</div>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">Performance</h1>
        </div>
        {ctx.branches.length > 1 && (
          <div className="w-full sm:w-64">
            <BranchSelect branches={ctx.branches.map((b) => ({ id: b.id, label: `${b.name} · ${VENUE[b.venueType]}` }))} branchId={ctx.branch?.id ?? null} />
          </div>
        )}
      </div>
      <SubNav
        label="Performance views"
        items={[
          { href: "/performance", label: "Overview" },
          { href: "/performance/ledger", label: "Expense & movement ledger" },
        ]}
      />
    </>
  );
}

