"use client";

// The section links inside a tab (Settings & Log, Performance). Not primary
// navigation: there are only ever three tabs.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubNav({ items, label }: { items: { href: string; label: string; count?: number }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-0.5 rounded-lg bg-stone-200/60 p-1 text-sm">
        {items.map((i) => {
          const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 ${
                  active ? "bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,0.08)]" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {i.label}
                {i.count ? <span className="num rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-800">{i.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
