import Link from "next/link";
import { Badge, Card, formatTime, SectionTitle } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { listRates } from "@/server/operations";

const SOURCE_LABEL = { market: "Market", bank: "Bank", custom: "Other" } as const;

/** Settings & Log › Rate history (v2.1): read-only. The rate is changed from the badge on Daily Close. */
export default async function RateHistoryPage() {
  const ctx = await requireContext();
  const rates = await listRates(await getDb(), ctx.scope);
  return (
    <>
      <SectionTitle
        title="Rate history"
        subtitle={
          <>
            1 USD = X LBP, as set by the business. Rates are never edited or deleted, and each business day keeps the rate it was opened with.{" "}
            {ctx.can("change_rate") ? (
              <>
                To change the rate, use the rate badge on{" "}
                <Link href="/close" className="underline">
                  Daily Close
                </Link>
                .
              </>
            ) : (
              "Only an owner, or someone they allow, can change it."
            )}
          </>
        }
      />
      <Card>
        {rates.length === 0 ? (
          <p className="text-sm text-stone-500">No rates yet.</p>
        ) : (
          <div className="-mx-5 -my-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-stone-100 bg-stone-50/60 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
                <tr>
                  <th className="px-5 py-2.5">Effective</th>
                  <th className="px-3 py-2.5 text-right">LBP per 1 USD</th>
                  <th className="px-3 py-2.5">Source</th>
                  <th className="px-3 py-2.5">Note</th>
                  <th className="px-5 py-2.5">Set by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rates.map((r, i) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-stone-700">
                      {formatTime(r.effectiveAt)} {i === 0 && <Badge tone="good">Active</Badge>}
                    </td>
                    <td className="num px-3 py-2.5 text-right font-medium text-stone-900">{formatRate(parseRate(r.lbpPerUsd))}</td>
                    <td className="px-3 py-2.5 text-stone-600">{SOURCE_LABEL[r.source]}</td>
                    <td className="px-3 py-2.5 text-stone-600">{r.note}</td>
                    <td className="px-5 py-2.5 text-stone-600">{r.createdByName?.replace(/\s*\(.*\)$/, "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
