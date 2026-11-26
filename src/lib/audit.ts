// Before and after values for the audit trail (v2.1 Settings & Log). The
// trail itself is written by the database and can't be changed; this only
// reads two stored copies of a row and says which fields differ.
import { formatAmount, type Currency } from "./money";

type Row = Record<string, unknown>;

/** Bookkeeping columns that change on their own and say nothing to a reader. */
const QUIET = new Set(["id", "org_id", "created_at", "updated_at", "headers", "rows", "mapping", "password_hash"]);

export type FieldChange = { field: string; before: string; after: string };

const label = (key: string) => key.replace(/_/g, " ");

function money(key: string, value: unknown, row: Row): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" || typeof value === "string" ? String(value) : null;
  if (n == null || !/^-?\d+$/.test(n)) return null;
  let currency: Currency | null = null;
  if (key === "amount_minor" && (row.currency === "USD" || row.currency === "LBP")) currency = row.currency;
  else if (key.endsWith("_usd") || key.endsWith("_cents")) currency = "USD";
  else if (key.endsWith("_lbp")) currency = "LBP";
  return currency ? formatAmount(BigInt(n), currency) : null;
}

export function displayValue(key: string, value: unknown, row: Row = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const m = money(key, value, row);
  if (m) return m;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** The fields that differ between the stored before and after copies of a row. */
export function changedFields(before: Row | null | undefined, after: Row | null | undefined): FieldChange[] {
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !QUIET.has(k));
  return keys
    .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map((k) => ({ field: label(k), before: displayValue(k, before[k], before), after: displayValue(k, after[k], after) }));
}
