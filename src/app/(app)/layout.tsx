import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { ROLE_LABEL } from "@/lib/roles";
import { isDemoMode, listDemoUsers, requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getNavCounts } from "@/server/operations";
import { PLAN_LIMITS } from "@/server/team";
import { Sidebar, type NavGroup } from "./sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const db = await getDb();
  const demo = isDemoMode();
  const [demoUsers, counts] = await Promise.all([demo ? listDemoUsers() : Promise.resolve(null), getNavCounts(db, ctx.scope)]);
  const role = ctx.active.role;
  const ops = role === "owner" || role === "manager";
  const books = role === "owner" || role === "accountant";

  const groups: NavGroup[] = [
    {
      label: "Operations",
      links: [
        { href: "/", label: "Today", icon: "today", count: counts.openDays, attention: true },
        { href: "/import", label: "POS import", icon: "import", count: ops ? counts.importDrafts : 0 },
        { href: "/rates", label: "Exchange rate", icon: "rate" },
      ],
    },
  ];
  if (books) {
    groups.push({
      label: "Finance",
      links: [
        { href: "/reports", label: "Reports", icon: "reports" },
        { href: "/audit", label: "Audit trail", icon: "audit" },
      ],
    });
  }
  const orgLinks: NavGroup["links"] = [];
  if (role === "owner") orgLinks.push({ href: "/team", label: "Team", icon: "team", count: counts.pendingInvites });
  if (ctx.memberships.length > 1) orgLinks.push({ href: "/clients", label: "All clients", icon: "clients" });
  if (orgLinks.length) groups.push({ label: "Organisation", links: orgLinks });

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
