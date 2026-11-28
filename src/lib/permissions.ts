// The permission matrix from FINCTRL v2.0 (section 2.3 and screen 8).
//
// Owners can do everything. Managers and accountants start from their role's
// defaults; an owner can switch the adjustable ones on or off per person
// (stored on the membership). Anything the spec says a role never does is not
// adjustable, and a stored override for it is ignored.
//
// The resolved list is handed to the database for each request
// (app.permissions), where the write policies check it too.
import type { Role } from "@/db/schema";

export type Permission =
  | "import_pos"
  | "record_transactions"
  | "close_days"
  | "change_rate"
  | "view_reports"
  | "export_reports"
  | "view_audit"
  | "post_corrections"
  | "manage_recipes"
  | "view_food_cost"
  | "manage_team";

type Rule = { default: boolean; adjustable: boolean };

export const PERMISSIONS: {
  key: Permission;
  label: string;
  hint: string;
  manager: Rule;
  accountant: Rule;
}[] = [
  {
    key: "import_pos",
    label: "Import POS sales",
    hint: "Upload and post POS files, or type in the POS end-of-day totals.",
    manager: { default: true, adjustable: true },
    accountant: { default: false, adjustable: true },
  },
  {
    key: "record_transactions",
    label: "Add expenses and cash movements",
    hint: "Operating expenses, safe drops, deposits and partner withdrawals.",
    manager: { default: true, adjustable: true },
    accountant: { default: false, adjustable: true },
  },
  {
    key: "close_days",
    label: "Open days, count cash and close",
    hint: "Opening floats, drawer counts, explanations and closing.",
    manager: { default: true, adjustable: true },
    accountant: { default: false, adjustable: false },
  },
  {
    key: "change_rate",
    label: "Change the exchange rate",
    hint: "Set the operational LBP rate used by new business days.",
    manager: { default: false, adjustable: true },
    accountant: { default: false, adjustable: false },
  },
  {
    // v2.1: managers work in Daily Close and see Performance only when an owner allows it (read-only).
    key: "view_reports",
    label: "See Performance",
    hint: "Totals, branch comparison and drawer differences for their own venues. Read-only.",
    manager: { default: false, adjustable: true },
    accountant: { default: true, adjustable: false },
  },
  {
    key: "export_reports",
    label: "Download reports",
    hint: "PDF and CSV downloads for their own venues.",
    manager: { default: false, adjustable: true },
    accountant: { default: true, adjustable: true },
  },
  {
    key: "view_audit",
    label: "See the audit trail",
    hint: "Changes at their own venues. Team changes stay with owners.",
    manager: { default: true, adjustable: true },
    accountant: { default: true, adjustable: true },
  },
  {
    key: "post_corrections",
    label: "Post corrections on closed days",
    hint: "Additive corrections; the closed figures never change.",
    manager: { default: false, adjustable: false },
    accountant: { default: false, adjustable: true },
  },
  {
    key: "manage_recipes",
    label: "Edit recipes and ingredient prices",
    hint: "Recipes, ingredients, their prices, and importing a costing workbook.",
    manager: { default: false, adjustable: true },
    accountant: { default: false, adjustable: false },
  },
  {
    key: "view_food_cost",
    label: "See food cost",
    hint: "Ingredient prices, recipe costs, food cost % and suggested prices.",
    manager: { default: false, adjustable: true },
    accountant: { default: true, adjustable: true },
  },
  {
    key: "manage_team",
    label: "Manage people and venues",
    hint: "Owners only.",
    manager: { default: false, adjustable: false },
    accountant: { default: false, adjustable: false },
  },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);

export function isPermission(v: string): v is Permission {
  return (ALL_PERMISSIONS as string[]).includes(v);
}

/** The permissions a membership ends up with, in the matrix's order. */
export function resolvePermissions(role: Role, overrides: Record<string, unknown> | null | undefined): Permission[] {
  if (role === "owner") return [...ALL_PERMISSIONS];
  return PERMISSIONS.filter((p) => {
    const rule = p[role];
    const o = overrides?.[p.key];
    return rule.adjustable && typeof o === "boolean" ? o : rule.default;
  }).map((p) => p.key);
}

/** Keeps only the overrides the role allows, and only where they differ from the default. */
export function cleanOverrides(role: Role, wanted: Record<string, unknown>): Record<string, boolean> {
  if (role === "owner") return {};
  const out: Record<string, boolean> = {};
  for (const p of PERMISSIONS) {
    const rule = p[role];
    const v = wanted[p.key];
    if (rule.adjustable && typeof v === "boolean" && v !== rule.default) out[p.key] = v;
  }
  return out;
}

export function can(access: { role: Role; permissions?: Permission[] }, p: Permission): boolean {
  if (access.role === "owner") return true;
  return (access.permissions ?? resolvePermissions(access.role, null)).includes(p);
}
