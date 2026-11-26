// Step 1's two read-outs: the day's sales by payment type (cash first, the
// rest marked as not physical drawer cash), and the form for typing in the
// POS end-of-day totals when there's no export.
import { saveSalesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { inputClass, Money } from "@/components/ui";
import { toInputValue, usdEquivalent, type Pair } from "@/lib/money";
import type { DayData } from "@/server/daily-close";

const NOT_DRAWER = "Not physical drawer cash";

function Tag({ drawer }: { drawer: boolean }) {
  return drawer ? (
    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700">In the drawer</span>
  ) : (
    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10.5px] font-medium text-stone-500">{NOT_DRAWER}</span>
  );
}

export function SalesSummary({ d }: { d: DayData }) {
  const s = d.sales;
  const apps: Pair = { USD: s.byTender.toters.USD + s.byTender.noknok.USD, LBP: s.byTender.toters.LBP + s.byTender.noknok.LBP };
  const rows: { label: string; pair: Pair; drawer?: boolean; memo?: boolean; strong?: boolean; sub?: boolean }[] = [
    { label: "Cash", pair: s.byTender.cash, drawer: true },
    { label: "Card", pair: s.byTender.card, drawer: false },
    { label: "Delivery apps", pair: apps, drawer: false },
    { label: "Toters", pair: s.byTender.toters, drawer: false, sub: true },
    { label: "NokNok", pair: s.byTender.noknok, drawer: false, sub: true },
    ...(s.byTender.other.USD || s.byTender.other.LBP ? [{ label: "Other payments", pair: s.byTender.other, drawer: false }] : []),
    { label: "Refunds", pair: { USD: -s.refunds.USD, LBP: -s.refunds.LBP } },
    { label: "Collected", pair: s.collected, strong: true },
    { label: "Discounts", pair: s.discounts, memo: true },
    { label: "Voids", pair: s.voids, memo: true },
    { label: "VAT", pair: s.tax, memo: true },
    ...(s.serviceCharge.USD || s.serviceCharge.LBP ? [{ label: "Service charge", pair: s.serviceCharge, memo: true }] : []),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
            <th />
            <th className="pb-2 font-medium">USD</th>
            <th className="pb-2 pl-3 font-medium">LBP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.strong ? "border-t border-stone-200 font-semibold text-stone-900" : r.memo ? "text-stone-500" : "text-stone-700"}>
              <td className={`py-1.5 pr-3 ${r.sub ? "pl-4 text-[13px] text-stone-500" : ""}`}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {r.label}
                  {r.drawer !== undefined && !r.sub && <Tag drawer={r.drawer} />}
                  {r.memo && <span className="text-[10px] text-stone-400">shown for checking, not deducted again</span>}
                </span>
              </td>
              <td className="py-1.5 text-right">
                <Money minor={r.pair.USD} currency="USD" className={r.pair.USD === 0n ? "text-stone-300" : ""} />
              </td>
              <td className="py-1.5 pl-3 text-right">
                <Money minor={r.pair.LBP} currency="LBP" className={r.pair.LBP === 0n ? "text-stone-300" : ""} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-500">
        Collected ≈ <Money minor={usdEquivalent(s.collected, d.rateScaled)} currency="USD" className="font-medium text-stone-700" /> at this
        day&apos;s rate. USD and LBP are kept apart; only cash goes into the drawer.
      </p>
    </div>
  );
}

const MANUAL_ROWS: { key: string; label: string; hint: string }[] = [
  { key: "cash", label: "Cash payments", hint: "Goes into the drawer" },
  { key: "card", label: "Card payments", hint: NOT_DRAWER },
  { key: "toters", label: "Toters", hint: `Delivery app. ${NOT_DRAWER}` },
  { key: "noknok", label: "NokNok", hint: `Delivery app. ${NOT_DRAWER}` },
  { key: "other", label: "Other payments", hint: `Wallets, transfers, vouchers. ${NOT_DRAWER}` },
  { key: "cashRefunds", label: "Cash refunds", hint: "Paid back out of the drawer" },
  { key: "discounts", label: "Discounts", hint: "For checking only" },
  { key: "voids", label: "Voids", hint: "For checking only" },
  { key: "tax", label: "VAT", hint: "Kept separate" },
  { key: "serviceCharge", label: "Service charge", hint: "For checking only" },
];

/** Typing the POS end-of-day (Z) totals by hand, when there is no export. */
export function ManualSalesForm({ d }: { d: DayData }) {
  const s = d.sales;
  const current: Record<string, Pair> = {
    cash: s.byTender.cash,
    card: s.byTender.card,
    toters: s.byTender.toters,
    noknok: s.byTender.noknok,
    other: s.byTender.other,
    cashRefunds: s.refunds,
    discounts: s.discounts,
    voids: s.voids,
    tax: s.tax,
    serviceCharge: s.serviceCharge,
  };
  return (
    <ActionForm action={saveSalesAction} submitLabel="Save sales totals">
      <input type="hidden" name="dayId" value={d.day.id} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
              <th className="pb-2 pr-3 font-medium">Line</th>
              <th className="w-32 pb-2 pr-2 text-right font-medium">USD</th>
              <th className="w-36 pb-2 text-right font-medium">LBP</th>
            </tr>
          </thead>
          <tbody>
            {MANUAL_ROWS.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pr-3">
                  <div className="font-medium text-stone-800">{r.label}</div>
                  <div className="text-xs text-stone-500">{r.hint}</div>
                </td>
                {(["USD", "LBP"] as const).map((c) => (
                  <td key={c} className={c === "USD" ? "py-1 pr-2" : "py-1"}>
                    <input
                      name={`${r.key}_${c}`}
                      inputMode="decimal"
                      placeholder={c === "USD" ? "0.00" : "0"}
                      defaultValue={current[r.key][c] ? toInputValue(current[r.key][c], c) : ""}
                      aria-label={`${r.label} in ${c}`}
                      className={`${inputClass} num min-w-24 text-right`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">LBP accepts shorthand like 4.5m or 250k.</p>
    </ActionForm>
  );
}
