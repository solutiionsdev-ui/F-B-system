import { addAdjustmentAction, closeDayAction, setOpeningFloatAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CountForm } from "@/components/count-form";
import { Badge, Card, Field, formatTime, inputClass, Money, REASON_LABELS } from "@/components/ui";
import { withinAllowance } from "@/lib/closing";
import { CURRENCIES, formatAmount, formatRate, toInputValue, usdEquivalent, zeroPair, type Pair } from "@/lib/money";
import type { DayData } from "./page";

const neg = (p: Pair): Pair => ({ USD: -p.USD, LBP: -p.LBP });

/** Expected vs counted, per currency. Closed days show the frozen figures. */
export function DrawerCard({ d }: { d: DayData }) {
  const b = d.breakdown;
  const c = d.closing;
  const expected: Pair = c ? { USD: c.expectedUsd, LBP: c.expectedLbp } : b.expected;
  const counted: Pair | null = c ? { USD: c.countedUsd, LBP: c.countedLbp } : null;
  const variance: Pair | null = c ? { USD: c.varianceUsd, LBP: c.varianceLbp } : null;
  const equiv = c ? c.varianceEquivCents : d.recon.varianceEquivCents;
  const within = c ? c.withinTolerance : d.recon.withinTolerance;
  const diff: Pair = c ? { USD: c.varianceUsd, LBP: c.varianceLbp } : d.recon.variance;
  const isBalanced = diff.USD === 0n && diff.LBP === 0n;
  const tol: Pair = c && c.toleranceUsdCents != null && c.toleranceLbp != null ? { USD: c.toleranceUsdCents, LBP: c.toleranceLbp } : d.tolerance;

  const lines: { label: string; pair: Pair; muted?: boolean }[] = [
    { label: "Opening float", pair: b.openingFloat },
    { label: "Cash payments", pair: b.cashPayments },
    { label: "Cash refunds", pair: neg(b.cashRefunds) },
    { label: "Paid from drawer", pair: neg(b.drawerExpenses) },
    { label: "Cash put in", pair: b.movementsIn },
    { label: "Cash taken out", pair: neg(b.movementsOut) },
  ];

  const cell = (currency: "USD" | "LBP", kind: "counted" | "variance") => {
    if (c) {
      const pair = kind === "counted" ? counted! : variance!;
      return <Money minor={pair[currency]} currency={currency} signed={kind === "variance"} variance={kind === "variance"} />;
    }
    const count = d.counts[currency];
    if (!count) return <span className="text-stone-400">Not counted</span>;
    if (kind === "counted") return <Money minor={count.countedMinor} currency={currency} />;
    return <Money minor={d.recon.variance[currency]} currency={currency} signed variance />;
  };

  return (
    <Card title="Drawer check" description={c ? "Frozen when the day was closed." : "Updates as you enter sales, expenses and counts."}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-stone-400">
            <th />
            <th className="pb-2 font-medium">USD</th>
            <th className="pb-2 pl-3 font-medium">LBP</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="text-stone-600">
              <td className="py-1 pr-2">{l.label}</td>
              <td className="py-1 text-right">
                <Money minor={l.pair.USD} currency="USD" className={l.pair.USD === 0n ? "text-stone-400" : ""} />
              </td>
              <td className="py-1 pl-3 text-right">
                <Money minor={l.pair.LBP} currency="LBP" className={l.pair.LBP === 0n ? "text-stone-400" : ""} />
              </td>
            </tr>
          ))}
          <tr className="border-t border-stone-200 font-semibold text-stone-900">
            <td className="py-2 pr-2">Expected</td>
            <td className="py-2 text-right">
              <Money minor={expected.USD} currency="USD" />
            </td>
            <td className="py-2 pl-3 text-right">
              <Money minor={expected.LBP} currency="LBP" />
            </td>
          </tr>
          <tr className="text-stone-700">
            <td className="py-1 pr-2">Counted</td>
            <td className="py-1 text-right">{cell("USD", "counted")}</td>
            <td className="py-1 pl-3 text-right">{cell("LBP", "counted")}</td>
          </tr>
          <tr className="font-medium">
            <td className="py-1 pr-2 text-stone-700">Difference</td>
            <td className="py-1 text-right">{cell("USD", "variance")}</td>
            <td className="py-1 pl-3 text-right">{cell("LBP", "variance")}</td>
          </tr>
        </tbody>
      </table>
      <div
        className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${
          !c && !d.countsComplete ? "bg-stone-50 text-stone-600" : within ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"
        }`}
      >
        {!c && !d.countsComplete ? (
          "Count both currencies to see whether the drawer balances."
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {isBalanced ? (
                "Both drawers match exactly."
              ) : (
                <>
                  {CURRENCIES.filter((cur) => diff[cur] !== 0n).map((cur, i) => (
                    <span key={cur}>
                      {i > 0 && " and "}
                      <Money minor={diff[cur]} currency={cur} signed className="font-semibold" />
                    </span>
                  ))}
                  <span className="opacity-75">
                    {" "}
                    (about <Money minor={equiv} currency="USD" signed /> at {formatRate(d.rateScaled)})
                  </span>
                </>
              )}
            </span>
            {within ? (
              <Badge tone="good">{c ? "Closed — Balanced" : "Balanced"}</Badge>
            ) : (
              <Badge tone="bad">{c ? "Closed — Flagged" : "Will be flagged"}</Badge>
            )}
          </div>
        )}
        <div className="mt-1 text-xs opacity-75">
          Each currency is checked on its own.{" "}
          {tol.USD === 0n && tol.LBP === 0n
            ? "Any difference flags the day."
            : `Allowed rounding: ±${formatAmount(tol.USD, "USD")} and ±${formatAmount(tol.LBP, "LBP")}.`}{" "}
          Any difference needs a written explanation.
        </div>
      </div>
    </Card>
  );
}

export function CountCard({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  if (!canOperate) return null;
  return (
    <Card id="count" step={3} title="Count the drawer" description="Count each currency separately. Enter how many of each note.">
      <details className="mb-5 rounded-lg border border-stone-200 px-3 py-2 text-sm" open={d.day.openingFloatUsd === 0n && d.day.openingFloatLbp === 0n}>
        <summary className="cursor-pointer font-medium text-stone-700">
          Opening float:{" "}
          <span className="num font-normal text-stone-600">
            {formatAmount(d.day.openingFloatUsd, "USD")} + {formatAmount(d.day.openingFloatLbp, "LBP")}
          </span>
        </summary>
        <ActionForm action={setOpeningFloatAction} submitLabel="Save float" variant="secondary" className="mt-3 space-y-3">
          <input type="hidden" name="dayId" value={d.day.id} />
          <p className="text-xs text-stone-500">The cash that was in the drawer before the first sale.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="USD">
              <input
                name="float_USD"
                inputMode="decimal"
                defaultValue={d.day.openingFloatUsd ? toInputValue(d.day.openingFloatUsd, "USD") : ""}
                placeholder="0.00"
                className={`${inputClass} num text-right`}
              />
            </Field>
            <Field label="LBP">
              <input
                name="float_LBP"
                inputMode="decimal"
                defaultValue={d.day.openingFloatLbp ? toInputValue(d.day.openingFloatLbp, "LBP") : ""}
                placeholder="0"
                className={`${inputClass} num text-right`}
              />
            </Field>
          </div>
        </ActionForm>
      </details>
      <div className="space-y-6">
        {CURRENCIES.map((c) => {
          const count = d.counts[c];
          return (
            <div key={c}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-800">{c}</h3>
                {count && <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-stone-400">Saved {formatTime(count.countedAt)}</span>}
              </div>
              <CountForm
                dayId={d.day.id}
                currency={c}
                initialNotes={count?.denominations ?? {}}
                initialLoose={count && count.looseMinor > 0n ? toInputValue(count.looseMinor, c) : ""}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function CloseCard({ d, canOperate }: { d: DayData; canOperate: boolean }) {
  const needsExplanation = d.recon.needsExplanation;
  return (
    <Card step={4} title="Close the day" description="Closing freezes the figures and locks the day.">
      {!canOperate ? (
        <p className="text-sm text-stone-500">Only owners and managers can close a day.</p>
      ) : !d.countsComplete ? (
        <p className="text-sm text-stone-500">Save both the USD and LBP counts first.</p>
      ) : (
        <ActionForm
          action={closeDayAction}
          submitLabel="Close and lock day"
          pendingLabel="Closing…"
          variant={needsExplanation || !d.recon.withinTolerance ? "danger" : "primary"}
          confirmText="Closing locks this day. Later corrections need an owner or accountant adjustment. Close now?"
        >
          <input type="hidden" name="dayId" value={d.day.id} />
          {!d.hasSales && (
            <Field
              label="No sales are recorded for this day. Why? (required)"
              hint="Or import the POS file or enter the totals before closing."
            >
              <input name="noSalesReason" required className={inputClass} placeholder="e.g. Closed for a public holiday" />
            </Field>
          )}
          {needsExplanation && (
            <>
              <Field label="Reason for the difference (required)">
                <select name="reason" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose a reason…
                  </option>
                  {Object.entries(REASON_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Explain what happened (required)" hint="Any difference in USD or LBP needs a written explanation.">
                <textarea name="note" rows={3} required className={inputClass} />
              </Field>
            </>
          )}
          {!needsExplanation && (
            <Field label="Note (optional)">
              <textarea name="note" rows={2} className={inputClass} />
            </Field>
          )}
        </ActionForm>
      )}
    </Card>
  );
}

export function ClosedSummary({ d, canAdjust }: { d: DayData; canAdjust: boolean }) {
  const c = d.closing!;
  const adj = zeroPair();
  for (const a of d.adjustments) adj[a.currency] += a.amountMinor;
  const adjusted: Pair = { USD: c.varianceUsd + adj.USD, LBP: c.varianceLbp + adj.LBP };
  const adjustedEquiv = usdEquivalent(adjusted, d.rateScaled);
  const resolved = withinAllowance(adjusted, d.tolerance);

  return (
    <section
      className={`mb-6 rounded-xl border bg-white p-5 shadow-xs ${c.withinTolerance ? "border-emerald-200" : "border-red-200"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-stone-900">{c.withinTolerance ? "Closed — Balanced" : "Closed — Flagged"}</h2>
          <p className="mt-1 text-sm text-stone-600">
            Difference <Money minor={c.varianceUsd} currency="USD" signed variance className="font-semibold" /> and{" "}
            <Money minor={c.varianceLbp} currency="LBP" signed variance className="font-semibold" />
            <span className="text-stone-500">
              {" "}
              (about <Money minor={c.varianceEquivCents} currency="USD" signed /> at the day&apos;s rate)
            </span>
            {c.varianceReason && <> · {REASON_LABELS[c.varianceReason]}</>}
          </p>
          {c.note && <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">“{c.note}”</p>}
          {c.noSalesReason && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No sales recorded: “{c.noSalesReason}”</p>
          )}
        </div>
        {d.adjustments.length > 0 && (
          <div className="text-right text-sm">
            <div className="text-xs font-medium text-stone-500">After corrections</div>
            <div className="text-lg font-semibold">
              <Money minor={adjusted.USD} currency="USD" signed variance />
            </div>
            <div className="font-semibold">
              <Money minor={adjusted.LBP} currency="LBP" signed variance />
            </div>
            <div className="text-xs text-stone-500">
              ≈ <Money minor={adjustedEquiv} currency="USD" signed /> · {resolved ? "explained" : "still open for review"}
            </div>
          </div>
        )}
      </div>

      {d.adjustments.length > 0 && (
        <ul className="mt-4 divide-y divide-stone-100 border-t border-stone-100 text-sm">
          {d.adjustments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-stone-700">
                {a.reason}
                <span className="ml-2 text-xs text-stone-500">
                  {a.createdByName} · {formatTime(a.createdAt)}
                </span>
              </span>
              <Money minor={a.amountMinor} currency={a.currency} signed />
            </li>
          ))}
        </ul>
      )}

      {canAdjust && (
        <details className="mt-4 rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-stone-700">Post a correction</summary>
          <p className="mt-2 text-xs text-stone-500">
            The closed figures never change. A correction is added on top, with your name and reason. Example: a receipt turns up for
            1,790,000 LBP paid from the drawer, so add +1,790,000 LBP.
          </p>
          <ActionForm action={addAdjustmentAction} submitLabel="Post correction" resetOnSuccess className="mt-3 space-y-3">
            <input type="hidden" name="dayId" value={d.day.id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Effect">
                <select name="direction" className={inputClass}>
                  <option value="plus">+ Reduces a shortage</option>
                  <option value="minus">− Increases it</option>
                </select>
              </Field>
              <Field label="Amount">
                <input name="amount" inputMode="decimal" className={`${inputClass} num text-right`} required />
              </Field>
              <Field label="Currency">
                <select name="currency" className={inputClass}>
                  <option value="LBP">LBP</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
              <Field label="Reason">
                <input name="reason" className={inputClass} required />
              </Field>
            </div>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
