import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { ROLE_LABEL } from "@/lib/roles";
import { isDemoMode, listDemoUsers, requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getNavCounts } from "@/server/operations";
import { PLAN_LIMITS } from "@/server/team";
import { Sidebar, type NavGroup } from "./sidebar";

const VENUE_LABEL = { restaurant: "Restaurant", cafe: "Café", pub: "Pub", other: "Venue" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const db = await getDb();
  const demo = isDemoMode();
  const [demoUsers, counts] = await Promise.all([
    demo ? listDemoUsers() : Promise.resolve(null),
    getNavCounts(db, ctx.scope, ctx.branch?.id ?? null),
  ]);
  const role = ctx.active.role;

  const groups: NavGroup[] = [
    {
      label: "Operations",
      links: [
        { href: "/", label: "Dashboard", icon: "dashboard" },
        { href: "/import", label: "POS Import", icon: "import", count: ctx.can("import_pos") ? counts.importDrafts : 0 },
        { href: "/closing", label: "Cash Closing", icon: "closing", count: counts.openDays, attention: true, also: ["/days"] },
        { href: "/expenses", label: "Expenses", icon: "expenses" },
        { href: "/cash", label: "Cash", icon: "cash" },
      ],
    },
  ];
  const finance: NavGroup["links"] = [];
  if (ctx.can("view_reports")) finance.push({ href: "/reports", label: "Reports", icon: "reports" });
  if (ctx.can("view_audit")) finance.push({ href: "/audit", label: "Audit Trail", icon: "audit" });
  if (finance.length) groups.push({ label: "Finance", links: finance });
  const orgLinks: NavGroup["links"] = [];
  if (ctx.can("manage_team")) orgLinks.push({ href: "/team", label: "Team & Access", icon: "team", count: counts.pendingInvites });
  orgLinks.push({ href: "/settings", label: "Settings", icon: "settings", also: ["/rates"] });
  if (ctx.memberships.length > 1) orgLinks.push({ href: "/clients", label: "All clients", icon: "clients" });
  groups.push({ label: "Organisation", links: orgLinks });

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar
          groups={groups}
          org={{
            id: ctx.active.orgId,
            name: ctx.active.orgName,
            subtitle: `${PLAN_LIMITS[counts.plan].label} plan · ${ROLE_LABEL[role]}`,
          }}
          orgs={ctx.memberships.map((m) => ({ id: m.orgId, label: m.orgName }))}
          branches={ctx.branches.map((b) => ({ id: b.id, label: `${b.name} · ${VENUE_LABEL[b.venueType]}` }))}
          branchId={ctx.branch?.id ?? null}
          user={{ id: ctx.user.id, name: ctx.user.name, role: ROLE_LABEL[role] }}
          demoUsers={demoUsers ? demoUsers.map((u) => ({ id: u.id, name: u.name })) : null}
        />
        <main className="w-full min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-9 xl:px-10">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
