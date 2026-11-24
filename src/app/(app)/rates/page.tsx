import { setRateAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, formatTime, inputClass, PageTitle } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listRates } from "@/server/operations";

const SOURCE_LABEL = { market: "Market", bank: "Bank", custom: "House rate" } as const;

export default async function RatesPage() {
  const ctx = await requireContext();
  const rates = await listRates(await getDb(), ctx.scope);
  const current = rates[0];
  const canSet = ctx.active.role === "owner" || ctx.active.role === "manager";

  return (
    <>
      <PageTitle
        title="Exchange rate"
        subtitle="Your restaurant's own LBP rate. Each business day keeps the rate it was opened with, so past reports never change."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Current rate</div>
            <div className="num mt-1 text-3xl font-semibold text-stone-900">
              {current ? formatRate(parseRate(current.lbpPerUsd)) : "—"}
              <span className="ml-1 text-base font-normal text-stone-500">LBP / $</span>
            </div>
            {current && (
              <div className="mt-1 text-sm text-stone-500">
                {SOURCE_LABEL[current.source]} · set {formatTime(current.effectiveAt)}
                {current.createdByName && <> by {current.createdByName}</>}
              </div>
            )}
          </Card>
          {canSet && (
            <Card title="Set a new rate" description="Applies to days opened from now on. Days already open keep their rate.">
              <ActionForm action={setRateAction} submitLabel="Save rate" resetOnSuccess>
                <Field label="LBP per 1 USD">
                  <input name="rate" inputMode="decimal" placeholder="89,500" className={`${inputClass} num text-right`} required />
                </Field>
                <Field label="Source">
                  <select name="source" className={inputClass}>
                    <option value="market">Market</option>
                    <option value="bank">Bank</option>
                    <option value="custom">House rate</option>
                  </select>
                </Field>
                <Field label="Note (optional)">
                  <input name="note" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>
        <Card title="History" description="Rates are never edited or deleted. Every change is kept with who made it.">
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-5 py-2.5">Effective</th>
                  <th className="px-3 py-2.5 text-right">LBP / $</th>
                  <th className="px-3 py-2.5">Source</th>
                  <th className="px-3 py-2.5">Note</th>
                  <th className="px-5 py-2.5">Set by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rates.map((r, i) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-stone-700">
                      {formatTime(r.effectiveAt)} {i === 0 && <Badge tone="good">Current</Badge>}
                    </td>
                    <td className="num px-3 py-2.5 text-right font-medium text-stone-900">{formatRate(parseRate(r.lbpPerUsd))}</td>
                    <td className="px-3 py-2.5 text-stone-600">{SOURCE_LABEL[r.source]}</td>
                    <td className="px-3 py-2.5 text-stone-600">{r.note}</td>
                    <td className="px-5 py-2.5 text-stone-600">{r.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
