import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { visibleTabs } from "@/lib/navigation";
import { ROLE_LABEL } from "@/lib/roles";
import { isDemoMode, listDemoUsers, requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getNavCounts } from "@/server/operations";
import { PLAN_LIMITS } from "@/server/team";
import { Sidebar, type NavTab } from "./sidebar";

const VENUE_LABEL = { restaurant: "Restaurant", cafe: "Café", pub: "Pub", other: "Venue" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const db = await getDb();
  const demo = isDemoMode();
  const [demoUsers, counts] = await Promise.all([
    demo ? listDemoUsers(ctx.active.orgId) : Promise.resolve(null),
    getNavCounts(db, ctx.scope, ctx.branch?.id ?? null),
  ]);
  const role = ctx.active.role;

  // FINCTRL v2.1: exactly three primary tabs. The older screens live inside them.
  const extra: Record<string, Partial<NavTab>> = {
    close: { icon: "closing", count: counts.openDays, attention: true, also: ["/days", "/import"] },
    performance: { icon: "reports" },
    settings: { icon: "settings", count: (ctx.can("import_pos") ? counts.importDrafts : 0) + counts.pendingInvites },
  };
  const tabs: NavTab[] = visibleTabs(ctx.scope).map((t) => ({ href: t.href, label: t.label, sub: t.sub, icon: "closing", ...extra[t.key] }));

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar
          tabs={tabs}
          org={{
            id: ctx.active.orgId,
            name: ctx.active.orgName,
            subtitle: `${PLAN_LIMITS[counts.plan].label} plan · ${ROLE_LABEL[role]}`,
          }}
          orgs={ctx.memberships.map((m) => ({ id: m.orgId, label: m.orgName }))}
          branches={ctx.branches.map((b) => ({ id: b.id, label: `${b.name} · ${VENUE_LABEL[b.venueType]}` }))}
          branchId={ctx.branch?.id ?? null}
          user={{ id: ctx.user.id, name: ctx.user.name, role: ROLE_LABEL[role] }}
          demoUsers={
            demoUsers
              ? demoUsers.map((u) => ({ id: u.id, name: `${u.name.replace(/\s*\(.*\)$/, "")} (${ROLE_LABEL[u.role]})` }))
              : null
          }
        />
        <main className="w-full min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-9 xl:px-10">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
