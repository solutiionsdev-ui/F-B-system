import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Card, Field, formatTime, inputClass, SectionTitle } from "@/components/ui";
import { changedFields } from "@/lib/audit";
import { MOVEMENT_LABELS, movementKindOf, PAID_FROM_LABELS, type MovementKind } from "@/lib/expense-buckets";
import { formatAmount, type Currency } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getAuditTrail } from "@/server/operations";

const THINGS: Record<string, string> = {
  organizations: "Settings",
  memberships: "Team member",
  membership_locations: "Venue access",
  invitations: "Invitation",
  locations: "Location",
  exchange_rates: "Exchange rate",
  business_days: "Business day",
  sales_lines: "Sales line",
  expense_categories: "Expense category",
  expenses: "Expense",
  cash_movements: "Cash movement",
  cash_counts: "Cash count",
  day_closings: "Day closing",
  adjustments: "Correction",
  pos_profiles: "POS format",
  pos_imports: "POS import",
};
const VERBS: Record<string, string> = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };

type Row = Record<string, unknown>;

function describe(table: string, op: string, oldData: Row | null, data: Row | null): string {
  const r = data ?? oldData ?? {};
  const amount =
    typeof r.amount_minor !== "undefined" && typeof r.currency === "string" ? formatAmount(BigInt(String(r.amount_minor)), r.currency as Currency) : null;
  switch (table) {
    case "exchange_rates":
      return `${Number(r.lbp_per_usd).toLocaleString("en-US")} LBP / $${r.source ? ` · ${r.source}` : ""}`;
    case "expenses": {
      const what = r.description ? String(r.description) : "expense";
      const paid = PAID_FROM_LABELS[String(r.paid_from)];
      if (op === "UPDATE" && r.status === "voided") return `Voided “${what}”: ${r.void_reason}`;
      return `${what} · ${amount}${paid ? ` · ${paid}` : ""}`;
    }
    case "sales_lines":
      return `${String(r.line_type).replace("_", " ")}${r.tender ? ` (${r.tender})` : ""} · ${amount}`;
    case "cash_movements": {
      const kind = movementKindOf({ kind: (r.kind as MovementKind | null) ?? null, direction: r.direction === "in" ? "in" : "out", reason: String(r.reason ?? "") });
      return `${MOVEMENT_LABELS[kind]}${r.partner_name ? ` · ${r.partner_name}` : ""}${r.reason ? `: ${r.reason}` : ""} · ${amount}`;
    }
    case "cash_counts":
      return `${r.currency} counted ${formatAmount(BigInt(String(r.counted_minor)), r.currency as Currency)}`;
    case "business_days":
      if (op === "UPDATE" && r.status === "closed") return `Closed ${r.business_date}`;
      return `${r.business_date}`;
    case "day_closings":
      return `USD ${formatAmount(BigInt(String(r.variance_usd ?? 0)), "USD", { signed: true })} · LBP ${formatAmount(BigInt(String(r.variance_lbp ?? 0)), "LBP", { signed: true })}${r.variance_reason ? ` (${String(r.variance_reason).replace("_", " ")})` : ""}${r.note ? ` · “${r.note}”` : ""}`;
    case "adjustments":
      return `${r.reason} · ${amount}`;
    case "pos_imports":
      return `${r.file_name ?? "file"} · ${r.status ?? ""}${r.lines_imported != null ? ` · ${r.lines_imported} lines` : ""}`;
    default:
      return String(r.name ?? r.email ?? "");
  }
}

type Search = { who?: string; what?: string; from?: string; to?: string };

/** Settings & Log › Audit Trail: append-only, written by the database, filterable, with before and after values. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("view_audit")) notFound();
  const sp = await searchParams;
  const trail = await getAuditTrail(await getDb(), ctx.scope, { userId: sp.who || null, table: sp.what || null, from: sp.from || null, to: sp.to || null, limit: 300 });
  const filtered = Boolean(sp.who || sp.what || sp.from || sp.to);

  return (
    <>
      <SectionTitle
        title="Audit Trail"
        subtitle="Every change, who made it and when, with the values before and after. Written by the database itself; nobody can edit or delete it."
      />
      <form action="/settings/audit" className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        <Field label="Person">
          <select name="who" defaultValue={sp.who ?? ""} className={inputClass}>
            <option value="">Everyone</option>
            {trail.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Record">
          <select name="what" defaultValue={sp.what ?? ""} className={inputClass}>
            <option value="">Everything</option>
            {trail.tables.map((t) => (
              <option key={t} value={t}>
                {THINGS[t] ?? t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
        </Field>
        <button className={buttonClass("secondary")}>Filter</button>
        {filtered && (
          <Link href="/settings/audit" className="pb-2 text-sm text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline">
            Clear
          </Link>
        )}
      </form>
      <Card>
        {trail.rows.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing matches these filters.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">When</th>
                  <th className="px-3 py-2.5">Who</th>
                  <th className="px-3 py-2.5">What</th>
                  <th className="px-5 py-2.5">Details · before → after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {trail.rows.map((r) => {
                  const changes = r.op === "UPDATE" ? changedFields(r.oldData as Row | null, r.newData as Row | null) : [];
                  return (
                    <tr key={String(r.id)} className="align-top">
                      <td className="whitespace-nowrap px-5 py-2 text-stone-600">{formatTime(r.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.userName ?? "System"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-900">
                        {THINGS[r.tableName] ?? r.tableName} {VERBS[r.op] ?? r.op}
                      </td>
                      <td className="min-w-64 px-5 py-2 text-stone-600">
                        {describe(r.tableName, r.op, r.oldData as Row | null, r.newData as Row | null)}
                        {changes.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {changes.slice(0, 8).map((c) => (
                              <li key={c.field}>
                                <span className="text-stone-500">{c.field}:</span> <span className="text-stone-400 line-through">{c.before}</span> →{" "}
                                <span className="font-medium text-stone-800">{c.after}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {trail.rows.length >= trail.limit && <p className="mt-3 text-xs text-stone-500">Showing the latest {trail.limit}. Narrow the filters to see older entries.</p>}
    </>
  );
}
