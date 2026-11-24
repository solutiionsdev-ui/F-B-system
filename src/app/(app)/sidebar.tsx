"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction, switchOrgAction } from "@/app/actions";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/ui";

export type NavLink = { href: string; label: string; icon: IconName; count?: number; attention?: boolean };
export type NavGroup = { label: string; links: NavLink[] };

type Props = {
  groups: NavGroup[];
  org: { id: string; name: string; subtitle: string };
  orgs: { id: string; label: string }[];
  user: { id: string; name: string; role: string };
  demoUsers: { id: string; name: string }[] | null;
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/days");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function SidebarBody({ groups, org, orgs, user, demoUsers, onNavigate }: Props & { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <Logo size={30} />
        <span className="text-[15px] font-semibold tracking-tight text-stone-900">Cash Control</span>
      </div>

      <div className="px-3">
        {orgs.length > 1 ? (
          <form action={switchOrgAction} className="relative">
            <label htmlFor="org-switcher" className="sr-only">
              Restaurant group
            </label>
            <select
              id="org-switcher"
              name="orgId"
              defaultValue={org.id}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full appearance-none rounded-xl border border-stone-200/80 bg-white py-2 pl-3 pr-8 text-sm font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.04)] focus:outline-none focus:ring-4 focus:ring-brand-500/15"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-400">⌄</span>
            <p className="mt-1 px-1 text-xs text-stone-500">{org.subtitle}</p>
          </form>
        ) : (
          <div className="rounded-xl border border-stone-200/80 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
            <div className="truncate text-sm font-medium text-stone-900">{org.name}</div>
            <div className="text-xs text-stone-500">{org.subtitle}</div>
          </div>
        )}
      </div>

      <nav className="mt-5 flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1.5 text-[11px] font-medium text-stone-400">{g.label}</div>
            <ul className="space-y-0.5">
              {g.links.map((l) => {
                const active = isActive(pathname, l.href);
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                        active
                          ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-stone-200/80"
                          : "text-stone-600 hover:bg-stone-200/40 hover:text-stone-900"
                      }`}
                    >
                      <Icon name={l.icon} className={active ? "text-stone-900" : "text-stone-400"} />
                      <span className="flex-1 truncate">{l.label}</span>
                      {l.count ? (
                        <span
                          className={`num rounded-md px-1.5 text-[11px] font-semibold leading-5 ${
                            l.attention ? "bg-brand-100 text-brand-700" : "bg-stone-200/70 text-stone-600"
                          }`}
                        >
                          {l.count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-stone-200/80 p-3">
        <div className="flex items-center gap-2.5 px-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-stone-900">{user.name.replace(/\s*\(.*\)$/, "")}</div>
            <div className="text-xs text-stone-500">{user.role}</div>
          </div>
        </div>
        {demoUsers ? (
          <form action="/auth/demo" method="get" className="mt-3">
            <label htmlFor="user-switcher" className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium text-stone-400">
              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">DEMO</span>
              Viewing as
            </label>
            <select
              id="user-switcher"
              name="user"
              defaultValue={user.id}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="w-full rounded-lg border border-stone-200 bg-white py-1.5 pl-2.5 pr-7 text-[13px] text-stone-800 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
            >
              {demoUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </form>
        ) : (
          <form action={logoutAction} className="mt-2">
            <button className="w-full rounded-lg px-3 py-1.5 text-left text-[13px] text-stone-500 hover:bg-stone-200/40 hover:text-stone-900">
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Desktop: a fixed sidebar. Phones: a top bar with a slide-out menu. */
export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 border-r border-stone-200/80 bg-sidebar lg:block">
        <SidebarBody {...props} />
      </aside>

      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200/80 bg-canvas/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-1 rounded-lg p-1.5 text-stone-700 hover:bg-stone-200/50"
          aria-label="Open menu"
          aria-expanded={open}
        >
          <Icon name="menu" size={20} />
        </button>
        <Logo size={26} />
        <span className="min-w-0 truncate text-sm font-semibold text-stone-900">{props.org.name}</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-stone-900/30" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-5 rounded-lg p-1.5 text-stone-500 hover:bg-stone-200/50"
              aria-label="Close menu"
            >
              <Icon name="close" size={18} />
            </button>
            <SidebarBody {...props} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
