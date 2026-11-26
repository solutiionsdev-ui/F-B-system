import { notFound } from "next/navigation";
import { Card, formatTime, PageTitle } from "@/components/ui";
import { MOVEMENT_LABELS, movementKindOf, PAID_FROM_LABELS, type MovementKind } from "@/lib/expense-buckets";
import { formatAmount, type Currency } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getAuditTrail } from "@/server/operations";

const THINGS: Record<string, string> = {
  organizations: "Settings",
  memberships: "Team member",
  locations: "Location",
  exchange_rates: "Exchange rate",
  business_days: "Business day",
  sales_lines: "Sales line",
  expense_categories: "Expense category",
  expenses: "Expense",
  cash_movements: "Cash movement",
  cash_counts: "Cash count",
  day_closings: "Day closing",
  adjustments: "Adjustment",
};
const VERBS: Record<string, string> = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };

type Row = Record<string, unknown>;

function describe(table: string, op: string, oldData: Row | null, data: Row | null): string {
  const r = data ?? oldData ?? {};
  const amount =
    typeof r.amount_minor !== "undefined" && typeof r.currency === "string"
      ? formatAmount(BigInt(String(r.amount_minor)), r.currency as Currency)
      : null;
  switch (table) {
    case "exchange_rates":
      return `${Number(r.lbp_per_usd).toLocaleString("en-US")} LBP / $`;
    case "expenses": {
      const what = r.description ? String(r.description) : "expense";
      const paid = PAID_FROM_LABELS[String(r.paid_from)];
      if (op === "UPDATE" && r.status === "voided") return `Voided “${what}”: ${r.void_reason}`;
      return `${what} · ${amount}${paid ? ` · ${paid}` : ""}`;
    }
    case "sales_lines":
      return `${String(r.line_type).replace("_", " ")}${r.tender ? ` (${r.tender})` : ""} · ${amount}`;
    case "cash_movements": {
      const kind = movementKindOf({
        kind: (r.kind as MovementKind | null) ?? null,
        direction: r.direction === "in" ? "in" : "out",
        reason: String(r.reason ?? ""),
      });
      return `${MOVEMENT_LABELS[kind]}${r.reason ? `: ${r.reason}` : ""} · ${amount}`;
    }
    case "cash_counts":
      return `${r.currency} counted ${formatAmount(BigInt(String(r.counted_minor)), r.currency as Currency)}`;
    case "business_days":
      if (op === "UPDATE" && r.status === "closed") return `Closed ${r.business_date}`;
      return `${r.business_date}`;
    case "day_closings":
      return `Difference ${formatAmount(BigInt(String(r.variance_equiv_cents)), "USD", { signed: true })}${r.variance_reason ? ` (${String(r.variance_reason).replace("_", " ")})` : ""}`;
    case "adjustments":
      return `${r.reason} · ${amount}`;
    default:
      return String(r.name ?? "");
  }
}

export default async function AuditPage() {
  const ctx = await requireContext();
  if (!ctx.can("view_audit")) notFound();
  const rows = await getAuditTrail(await getDb(), ctx.scope, 200);

  return (
    <>
      <PageTitle
        title="Audit trail"
        subtitle="Every change, who made it and when. Written by the database itself and can't be edited or deleted."
      />
      <Card>
        <div className="-mx-5 -my-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
              <tr>
                <th className="px-5 py-2.5">When</th>
                <th className="px-3 py-2.5">Who</th>
                <th className="px-3 py-2.5">What</th>
                <th className="px-5 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td className="whitespace-nowrap px-5 py-2 text-stone-600">{formatTime(r.at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-700">{r.userName ?? "System"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-stone-900">
                    {THINGS[r.tableName] ?? r.tableName} {VERBS[r.op] ?? r.op}
                  </td>
                  <td className="px-5 py-2 text-stone-600">
                    {describe(r.tableName, r.op, r.oldData as Row | null, r.newData as Row | null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
