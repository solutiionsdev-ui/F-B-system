// The three primary tabs of FINCTRL v2.1 and which one each person lands on.
//
// Daily Close is the manager's nightly page. Performance is the owner's and
// the accountant's view, and a manager sees it only when an owner has allowed
// it. Settings & Log holds the POS formats, the team, the audit trail and the
// rate history. There is no fourth tab.
import type { Role } from "@/db/schema";
import { can, type Permission } from "./permissions";

export type TabKey = "close" | "performance" | "settings";

export const TABS: { key: TabKey; href: string; label: string; sub: string }[] = [
  { key: "close", href: "/close", label: "Daily Close", sub: "Import, log, count" },
  { key: "performance", href: "/performance", label: "Performance", sub: "Totals and branches" },
  { key: "settings", href: "/settings", label: "Settings & Log", sub: "Formats, team, audit" },
];

type Access = { role: Role; permissions?: Permission[] };

/** The tabs a person can open. Performance needs the reports permission; the other two are for everyone. */
export function visibleTabs(access: Access) {
  return TABS.filter((t) => t.key !== "performance" || can(access, "view_reports"));
}

/** Where "/" takes someone: managers to Daily Close, owners and accountants to Performance. */
export function homePath(access: Access): string {
  return access.role !== "manager" && can(access, "view_reports") ? "/performance" : "/close";
}
