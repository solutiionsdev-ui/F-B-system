"use client";

// FINCTRL v2.1 navigation: exactly three primary tabs (Daily Close,
// Performance, Settings & Log). Business and branch at the top left, the
// person (and the demo role switcher) at the bottom left. On phones the three
// tabs sit in a row under the top bar; the rest is in the slide-out menu.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logoutAction, switchOrgAction } from "@/app/actions";
import { BranchSelect, type BranchOption } from "@/components/branch-select";
import { Icon, type IconName } from "@/components/icons";
import { Logo } from "@/components/ui";

/** `also`: other path prefixes that belong to this tab (a day page belongs to Daily Close). */
export type NavTab = {
  href: string;
  label: string;
  /** A few words under the label. */
  sub?: string;
  icon: IconName;
  count?: number;
  attention?: boolean;
  also?: string[];
};

type Props = {
  tabs: NavTab[];
  /** The Kitchen group: recipes, inventory, food cost. */
  kitchen: NavTab[];
  org: { id: string; name: string; subtitle: string };
  orgs: { id: string; label: string }[];
  /** Venues this person may see; the branch picked applies to every tab. */
  branches: BranchOption[];
  branchId: string | null;
  user: { id: string; name: string; role: string };
  demoUsers: { id: string; name: string }[] | null;
};

function isActive(pathname: string, tab: NavTab) {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  return under(tab.href) || (tab.also ?? []).some(under);
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

function CountPill({ tab }: { tab: NavTab }) {
  if (!tab.count) return null;
  return (
    <span
      className={`num rounded-md px-1.5 text-[11px] font-semibold leading-5 ${
        tab.attention ? "bg-amber-100 text-amber-800" : "bg-stone-200/70 text-stone-600"
      }`}
    >
      {tab.count}
    </span>
  );
}

function TabLink({ t, pathname, onNavigate }: { t: NavTab; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, t);
  return (
    <Link
      href={t.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
        active ? "bg-white shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-stone-200/80" : "hover:bg-stone-200/40"
      }`}
    >
      <Icon name={t.icon} className={active ? "text-stone-900" : "text-stone-400"} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${active ? "font-semibold text-stone-900" : "font-medium text-stone-700"}`}>{t.label}</span>
        {t.sub && <span className="block truncate text-[11.5px] text-stone-400">{t.sub}</span>}
      </span>
      <CountPill tab={t} />
    </Link>
  );
}

function SidebarBody({ tabs, kitchen, org, orgs, branches, branchId, user, demoUsers, onNavigate }: Props & { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <Logo size={30} />
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-[0.04em] text-stone-900">FINCTRL</span>
          <span className="block text-[11px] text-stone-500">Hospitality Financial Control</span>
        </span>
      </div>

      <div className="space-y-2 px-3">
        {orgs.length > 1 ? (
          <form action={switchOrgAction} className="relative">
            <label htmlFor="org-switcher" className="sr-only">
              Business
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
            <span className="pointer-events-none absolute right-3 top-[18px] -translate-y-1/2 text-stone-400">⌄</span>
            <div className="mt-1 flex items-center justify-between gap-2 px-1 text-xs text-stone-500">
              <span className="truncate">{org.subtitle}</span>
              <Link href="/clients" onClick={onNavigate} className="shrink-0 underline-offset-2 hover:text-stone-900 hover:underline">
                All businesses
              </Link>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-stone-200/80 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
            <div className="truncate text-sm font-medium text-stone-900">{org.name}</div>
            <div className="text-xs text-stone-500">{org.subtitle}</div>
          </div>
        )}
        <BranchSelect branches={branches} branchId={branchId} />
      </div>

      <nav className="mt-6 flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
        <ul className="space-y-1">
          {tabs.map((t) => (
            <li key={t.href}>
              <TabLink t={t} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        {kitchen.length > 0 && (
          <div>
            <div className="px-3 pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-stone-400">Kitchen</div>
            <ul className="space-y-1">
              {kitchen.map((t) => (
                <li key={t.href}>
                  <TabLink t={t} pathname={pathname} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        )}
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
            <input type="hidden" name="org" value={org.id} />
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

/** Desktop: a fixed sidebar. Phones and tablets: a top bar, the three tabs in a row, and a slide-out menu. */
export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 border-r border-stone-200/80 bg-sidebar lg:block">
        <SidebarBody {...props} />
      </aside>

      <div className="sticky top-0 z-30 border-b border-stone-200/80 bg-canvas/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
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
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900">{props.org.name}</span>
        </div>
        <nav aria-label="Tabs" className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
          {[...props.tabs, ...props.kitchen].map((t) => {
            const active = isActive(pathname, t);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] ${
                  active ? "bg-white font-semibold text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)] ring-1 ring-stone-200/80" : "text-stone-600"
                }`}
              >
                <Icon name={t.icon} size={15} className={`hidden sm:block ${active ? "text-stone-900" : "text-stone-400"}`} />
                <span className="truncate">{t.label}</span>
                <CountPill tab={t} />
              </Link>
            );
          })}
        </nav>
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
