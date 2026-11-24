import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions";
import { buttonClass } from "@/components/ui";
import { isDemoMode, listDemoUsers, requireContext } from "@/server/auth";
import { OrgSwitcher } from "./org-switcher";
import { UserSwitcher } from "./user-switcher";

const ROLE_LABEL = { owner: "Owner", manager: "Manager", accountant: "Accountant" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const demo = isDemoMode();
  const demoUsers = demo ? await listDemoUsers() : [];
  const role = ctx.active.role;
  const links = [
    { href: "/", label: "Today" },
    { href: "/rates", label: "Exchange rate" },
    ...(role === "owner" || role === "accountant"
      ? [
          { href: "/reports", label: "Reports" },
          { href: "/audit", label: "Audit trail" },
        ]
      : []),
    ...(role === "owner" ? [{ href: "/team", label: "Team" }] : []),
    ...(ctx.memberships.length > 1 ? [{ href: "/clients", label: "All clients" }] : []),
  ];
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-stone-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">$</span>
            Cash Control
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <OrgSwitcher
              active={ctx.active.orgId}
              options={ctx.memberships.map((m) => ({ id: m.orgId, label: m.orgName }))}
            />
            {demo ? (
              <UserSwitcher current={ctx.user.id} users={demoUsers} />
            ) : (
              <>
                <span className="hidden text-stone-500 md:inline">
                  {ctx.user.name} · {ROLE_LABEL[role]}
                </span>
                <form action={logoutAction}>
                  <button className={buttonClass("ghost")}>Sign out</button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
