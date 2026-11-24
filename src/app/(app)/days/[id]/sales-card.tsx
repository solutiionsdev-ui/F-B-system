import Link from "next/link";
import { saveSalesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, inputClass, Money } from "@/components/ui";
import { toInputValue, usdEquivalent, type Pair } from "@/lib/money";
import type { DayData } from "./page";

export function SalesCard({ d, canOperate: canEdit }: { d: DayData; canOperate: boolean }) {
  const s = d.sales;
  const importIds = [...new Set(d.lines.map((l) => l.importId).filter((x): x is string => Boolean(x)))];
  const hasImports = importIds.length > 0;
  // Imported days are read-only here, so the same sale is never entered twice.
  const canOperate = canEdit && !hasImports;
  const rows: { key: string; label: string; hint?: string; pair: Pair }[] = [
    { key: "cash", label: "Cash payments", hint: "Goes into the drawer", pair: s.byTender.cash },
    { key: "card", label: "Card payments", pair: s.byTender.card },
    { key: "other", label: "Other payments", hint: "Wallets, transfers, vouchers", pair: s.byTender.other },
    hasImports
      ? { key: "cashRefunds", label: "Refunds", hint: "Cash and card", pair: s.refunds }
      : { key: "cashRefunds", label: "Cash refunds", hint: "Paid back out of the drawer", pair: s.refunds },
    { key: "discounts", label: "Discounts", pair: s.discounts },
    { key: "voids", label: "Voids", pair: s.voids },
    { key: "tax", label: "VAT", pair: s.tax },
    { key: "serviceCharge", label: "Service charge", pair: s.serviceCharge },
  ];
  const collectedEquiv = usdEquivalent(s.collected, d.rateScaled);

  const footer = (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
      <span className="text-stone-600">Collected after refunds</span>
      <span className="num font-medium text-stone-900">
        <Money minor={s.collected.USD} currency="USD" /> + <Money minor={s.collected.LBP} currency="LBP" />
        <span className="ml-2 text-stone-500">
          ≈ <Money minor={collectedEquiv} currency="USD" />
        </span>
      </span>
    </div>
  );

  return (
    <Card
      step={1}
      title="Sales from the POS"
      description={
        hasImports
          ? "Imported from the POS export."
          : canOperate
            ? "Copy the totals from the POS end-of-day (Z) report, or import the POS export instead. LBP accepts shorthand like 4.5m or 250k."
            : "Totals from the POS end-of-day report."
      }
    >
      {hasImports && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {d.lines.length} lines from{" "}
          {importIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <Link href={`/import/${id}`} className="font-medium underline">
                {importIds.length > 1 ? `import ${i + 1}` : "this import"}
              </Link>
            </span>
          ))}
          . To type totals by hand instead, undo the import first.
        </p>
      )}
      {canOperate ? (
        <ActionForm action={saveSalesAction} submitLabel="Save sales totals">
          <input type="hidden" name="dayId" value={d.day.id} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                  <th className="pb-2 pr-3 font-medium">Line</th>
                  <th className="w-36 pb-2 pr-2 text-right font-medium">USD</th>
                  <th className="w-40 pb-2 text-right font-medium">LBP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-1 pr-3">
                      <div className="font-medium text-stone-800">{r.label}</div>
                      {r.hint && <div className="text-xs text-stone-500">{r.hint}</div>}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        name={`${r.key}_USD`}
                        inputMode="decimal"
                        placeholder="0.00"
                        defaultValue={r.pair.USD ? toInputValue(r.pair.USD, "USD") : ""}
                        aria-label={`${r.label} in USD`}
                        className={`${inputClass} num text-right`}
                      />
                    </td>
                    <td className="py-1">
                      <input
                        name={`${r.key}_LBP`}
                        inputMode="decimal"
                        placeholder="0"
                        defaultValue={r.pair.LBP ? toInputValue(r.pair.LBP, "LBP") : ""}
                        aria-label={`${r.label} in LBP`}
                        className={`${inputClass} num text-right`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {footer}
        </ActionForm>
      ) : (
        <div className="space-y-3">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5 text-stone-700">{r.label}</td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right">
                    <Money minor={r.pair.USD} currency="USD" />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pl-4 text-right">
                    <Money minor={r.pair.LBP} currency="LBP" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {footer}
        </div>
      )}
    </Card>
  );
}
