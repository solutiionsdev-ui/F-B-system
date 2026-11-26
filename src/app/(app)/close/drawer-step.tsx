// Daily Close, step 3: count the USD and LBP drawers, each on its own card.
// Expected cash is worked out per currency by the shared engine
// (lib/closing.ts via getDay); nothing is converted or combined here.
import { addAdjustmentAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CountForm } from "@/components/count-form";
import { Badge, Card, Field, formatTime, inputClass, Money, REASON_LABELS } from "@/components/ui";
import { withinAllowance } from "@/lib/closing";
import { CURRENCIES, formatAmount, formatRate, toInputValue, usdEquivalent, zeroPair, type Currency, type Pair } from "@/lib/money";
import type { DayData } from "@/server/daily-close";
import { ClosePanel } from "./close-panel";

function frozen(d: DayData) {
  const c = d.closing;
  return c
    ? {
        expected: { USD: c.expectedUsd, LBP: c.expectedLbp } as Pair,
        counted: { USD: c.countedUsd, LBP: c.countedLbp } as Pair,
        variance: { USD: c.varianceUsd, LBP: c.varianceLbp } as Pair,
      }
    : null;
}

function CurrencyDrawer({ d, currency, canCount }: { d: DayData; currency: Currency; canCount: boolean }) {
  const b = d.breakdown;
  const f = frozen(d);
  const c = currency;
  const expected = f ? f.expected[c] : b.expected[c];
  const count = d.counts[c];
  const counted = f ? f.counted[c] : (count?.countedMinor ?? null);
  const variance = f ? f.variance[c] : count ? d.recon.variance[c] : null;
  const adjusted = b.floatAdjustments[c] !== 0n;

  const rows: { label: string; value: bigint; sign?: "+" | "−"; strong?: boolean; hide?: boolean }[] = [
    { label: adjusted ? "Opening float (original)" : "Opening float", value: b.openingFloat[c] },
    { label: "Float adjustments", value: b.floatAdjustments[c], hide: !adjusted },
    { label: "Adjusted opening float", value: b.adjustedFloat[c], strong: true, hide: !adjusted },
    { label: "Cash sales", value: b.cashPayments[c], sign: "+" },
    { label: "Cash refunds", value: b.cashRefunds[c], sign: "−", hide: b.cashRefunds[c] === 0n },
    { label: "Expenses paid from the drawer", value: b.drawerExpenses[c], sign: "−" },
    { label: "Cash put into the drawer", value: b.movementsIn[c], sign: "+", hide: b.movementsIn[c] === 0n },
    { label: "Safe drops, deposits, withdrawals", value: b.movementsOut[c], sign: "−" },
  ];

  return (
    <section className="min-w-0 rounded-xl border border-stone-200">
      <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-stone-900">{c} drawer</h3>
        {variance == null ? (
          <Badge>Not counted</Badge>
        ) : variance === 0n ? (
          <Badge tone="good">Matches</Badge>
        ) : (
          <Badge tone={variance < 0n ? "bad" : "warn"}>{variance < 0n ? "Short" : "Over"}</Badge>
        )}
      </header>
      <dl className="space-y-1 px-4 py-3 text-sm">
        {rows
          .filter((r) => !r.hide)
          .map((r) => (
            <div key={r.label} className={`flex items-baseline justify-between gap-3 ${r.strong ? "font-medium text-stone-800" : "text-stone-600"}`}>
              <dt>
                {r.sign && <span className="mr-1 inline-block w-3 text-stone-400">{r.sign}</span>}
                {r.label}
              </dt>
              <dd>
                <Money minor={r.value} currency={c} signed={r.label === "Float adjustments"} className={r.value === 0n ? "text-stone-300" : ""} />
              </dd>
            </div>
          ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-2 font-semibold text-stone-900">
          <dt>Expected in the drawer</dt>
          <dd>
            <Money minor={expected} currency={c} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-stone-700">
          <dt>Counted</dt>
          <dd>{counted == null ? <span className="text-stone-400">Not counted yet</span> : <Money minor={counted} currency={c} />}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 font-semibold">
          <dt className="text-stone-700">Variance</dt>
          <dd>{variance == null ? <span className="font-normal text-stone-400">—</span> : <Money minor={variance} currency={c} signed variance />}</dd>
        </div>
      </dl>
      {canCount && (
        <div className="border-t border-stone-100 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-stone-600">Count by note</span>
            {count && <span className="font-mono uppercase tracking-[0.06em] text-stone-400">Saved {formatTime(count.countedAt)}</span>}
          </div>
          <CountForm
            dayId={d.day.id}
            currency={c}
            initialNotes={count?.denominations ?? {}}
            initialLoose={count && count.looseMinor > 0n ? toInputValue(count.looseMinor, c) : ""}
          />
        </div>
      )}
    </section>
  );
}

/** Card, Toters, NokNok and other payments: collected, but never in the drawer. */
function NotDrawerCash({ d }: { d: DayData }) {
  const t = d.sales.byTender;
  const items: [string, Pair][] = [
    ["Card", t.card],
    ["Toters", t.toters],
    ["NokNok", t.noknok],
    ["Other", t.other],
  ];
  const shown = items.filter(([, p]) => p.USD !== 0n || p.LBP !== 0n);
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-4 py-3 text-sm">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-stone-700">Not physical drawer cash</span>
        <span className="text-xs text-stone-500">Collected, but never counted in a drawer</span>
      </div>
      {shown.length === 0 ? (
        <p className="text-stone-500">No card or delivery-app payments recorded.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {shown.map(([label, p]) => (
            <li key={label} className="text-stone-700">
              {label}{" "}
              <span className="num font-medium text-stone-900">
                {CURRENCIES.filter((c) => p[c] !== 0n)
                  .map((c) => formatAmount(p[c], c))
                  .join(" + ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClosedSummary({ d, canAdjust }: { d: DayData; canAdjust: boolean }) {
  const c = d.closing!;
  const adj = zeroPair();
  for (const a of d.adjustments) adj[a.currency] += a.amountMinor;
  const adjusted: Pair = { USD: c.varianceUsd + adj.USD, LBP: c.varianceLbp + adj.LBP };
  const resolved = withinAllowance(adjusted, d.tolerance);
  return (
    <section className={`rounded-xl border p-4 ${c.withinTolerance ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-stone-900">
            {c.withinTolerance ? "Closed — Balanced" : "Closed — Flagged"}
            <span className="ml-2 text-sm font-normal text-stone-500">
              by {d.closedByName?.replace(/\s*\(.*\)$/, "") ?? "—"}
              {d.day.closedAt && <> · {formatTime(d.day.closedAt)}</>}
            </span>
          </h3>
          <p className="mt-1 text-sm text-stone-600">
            Variance <Money minor={c.varianceUsd} currency="USD" signed variance className="font-semibold" /> and{" "}
            <Money minor={c.varianceLbp} currency="LBP" signed variance className="font-semibold" />
            {c.varianceReason && <> · {REASON_LABELS[c.varianceReason]}</>}
          </p>
          {c.note && <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-stone-700">“{c.note}”</p>}
          {c.noSalesReason && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No sales recorded: “{c.noSalesReason}”</p>}
        </div>
        {d.adjustments.length > 0 && (
          <div className="text-right text-sm">
            <div className="text-xs font-medium text-stone-500">After corrections</div>
            <div className="font-semibold">
              <Money minor={adjusted.USD} currency="USD" signed variance />
            </div>
            <div className="font-semibold">
              <Money minor={adjusted.LBP} currency="LBP" signed variance />
            </div>
            <div className="text-xs text-stone-500">
              ≈ <Money minor={usdEquivalent(adjusted, d.rateScaled)} currency="USD" signed /> · {resolved ? "explained" : "still open for review"}
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-stone-500">The closed figures are locked and never change. Corrections are added on top, each with a name and a reason.</p>
      {d.adjustments.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-200/70 border-t border-stone-200/70 text-sm">
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
        <details className="mt-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-stone-700">Post a correction</summary>
          <p className="mt-2 text-xs text-stone-500">
            Example: a receipt turns up for 45,000 LBP paid from the drawer, so add +45,000 LBP. The original closing stays as it was.
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

const toneOf = (v: bigint) => (v < 0n ? "short" : v > 0n ? "over" : "zero") as "short" | "over" | "zero";

export function DrawerStep({ d, canClose, canAdjust }: { d: DayData; canClose: boolean; canAdjust: boolean }) {
  const open = d.day.status === "open";
  const v = d.recon.variance;
  const discrepancy = open && d.countsComplete && (v.USD !== 0n || v.LBP !== 0n);
  const status = !open ? (
    d.closing?.withinTolerance ? <Badge tone="good">Closed — Balanced</Badge> : <Badge tone="bad">Closed — Flagged</Badge>
  ) : d.countsComplete ? (
    discrepancy ? <Badge tone="bad">Difference found</Badge> : <Badge tone="good">Both drawers match</Badge>
  ) : (
    <Badge>Count both currencies</Badge>
  );

  return (
    <Card
      id="step-3"
      step={3}
      title="Count USD & LBP drawers"
      description="Each currency is expected, counted and checked on its own. Nothing is converted."
      actions={status}
    >
      <div className="space-y-4">
        {!open && d.closing && <ClosedSummary d={d} canAdjust={canAdjust} />}
        <div className="grid items-start gap-4 md:grid-cols-2">
          <CurrencyDrawer d={d} currency="USD" canCount={open && canClose} />
          <CurrencyDrawer d={d} currency="LBP" canCount={open && canClose} />
        </div>
        <NotDrawerCash d={d} />

        {discrepancy && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <div className="font-semibold">
              Discrepancy:{" "}
              {CURRENCIES.filter((c) => v[c] !== 0n)
                .map((c) => `${v[c] < 0n ? "short" : "over"} ${formatAmount(v[c] < 0n ? -v[c] : v[c], c)} in the ${c} drawer`)
                .join(" · ")}
            </div>
            <div className="mt-0.5 text-[13px]">
              Recount first. If the difference is real, the manager must explain it in writing before the day can close. Each currency&apos;s
              variance is kept on its own.
              {(d.tolerance.USD !== 0n || d.tolerance.LBP !== 0n) && (
                <> Rounding allowance: ±{formatAmount(d.tolerance.USD, "USD")} and ±{formatAmount(d.tolerance.LBP, "LBP")}.</>
              )}
            </div>
          </div>
        )}

        {open && (
          <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
            {!canClose ? (
              <p className="text-sm text-stone-500">You can see this day. Counting and closing are done by someone allowed to close days.</p>
            ) : !d.countsComplete ? (
              <p className="text-sm text-stone-600">Save both the USD and the LBP count to close the day.</p>
            ) : (
              <ClosePanel
                dayId={d.day.id}
                hasSales={d.hasSales}
                needsExplanation={d.recon.needsExplanation}
                willFlag={!d.recon.withinTolerance}
                expected={{ USD: formatAmount(d.breakdown.expected.USD, "USD"), LBP: formatAmount(d.breakdown.expected.LBP, "LBP") }}
                counted={{ USD: formatAmount(d.recon.counted.USD, "USD"), LBP: formatAmount(d.recon.counted.LBP, "LBP") }}
                variance={{ USD: formatAmount(v.USD, "USD", { signed: true }), LBP: formatAmount(v.LBP, "LBP", { signed: true }) }}
                varianceTone={{ USD: toneOf(v.USD), LBP: toneOf(v.LBP) }}
              />
            )}
            <p className="mt-3 text-xs text-stone-500">Rate for reference: 1 USD = {formatRate(d.rateScaled)} LBP. It never mixes the two drawers.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
