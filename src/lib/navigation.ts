// The tabs of FINCTRL and which one each person lands on.
//
// The money side (v2.1): Daily Close is the manager's nightly page.
// Performance is the owner's and the accountant's view, and a manager sees it
// only when an owner has allowed it. Settings & Log holds the POS formats, the
// team, the audit trail and the rate history.
//
// The Kitchen group (added 28 Nov 2026 at the owner's request): Recipes,
// Inventory (the ingredient price list for now; stock comes next) and Food
// Cost, which needs the food cost permission.
import type { Role } from "@/db/schema";
import { can, type Permission } from "./permissions";

export type TabKey = "close" | "performance" | "settings" | "recipes" | "inventory" | "food-cost";

export const TABS: { key: TabKey; href: string; label: string; sub: string }[] = [
  { key: "close", href: "/close", label: "Daily Close", sub: "Import, log, count" },
  { key: "performance", href: "/performance", label: "Performance", sub: "Totals and branches" },
  { key: "settings", href: "/settings", label: "Settings & Log", sub: "Formats, team, audit" },
];

type Access = { role: Role; permissions?: Permission[] };

export const KITCHEN_TABS: { key: TabKey; href: string; label: string; sub: string }[] = [
  { key: "recipes", href: "/kitchen/recipes", label: "Recipes", sub: "Dishes and preps" },
  { key: "inventory", href: "/kitchen/inventory", label: "Inventory", sub: "Ingredients and prices" },
  { key: "food-cost", href: "/kitchen/food-cost", label: "Food Cost", sub: "Cost against price" },
];

/** The Kitchen tabs a person can open. Food Cost needs the food cost permission. */
export function visibleKitchenTabs(access: Access) {
  return KITCHEN_TABS.filter((t) => t.key !== "food-cost" || can(access, "view_food_cost"));
}

/** The tabs a person can open. Performance needs the reports permission; the other two are for everyone. */
export function visibleTabs(access: Access) {
  return TABS.filter((t) => t.key !== "performance" || can(access, "view_reports"));
}

/** Where "/" takes someone: managers to Daily Close, owners and accountants to Performance. */
export function homePath(access: Access): string {
  return access.role !== "manager" && can(access, "view_reports") ? "/performance" : "/close";
}
