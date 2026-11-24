"use client";

import { useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { inlineInputClass, inputClass, labelClass } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import type { Mapping } from "@/lib/pos-import";

const TENDER_OPTIONS = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["other", "Other (wallet, transfer…)"],
  ["skip", "Don't import"],
] as const;
const TYPE_OPTIONS = [
  ["payment", "Payment"],
  ["refund", "Refund"],
  ["discount", "Discount"],
  ["void", "Void"],
  ["tax", "VAT"],
  ["service_charge", "Service charge"],
  ["skip", "Don't import"],
] as const;
const CURRENCY_OPTIONS = [
  ["USD", "USD"],
  ["LBP", "LBP"],
  ["skip", "Don't import"],
] as const;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-stone-100 pt-4 first:border-0 first:pt-0">
      <legend className="text-sm font-semibold text-stone-900">{title}</legend>
      {hint && <p className="mb-2 mt-0.5 text-xs text-stone-500">{hint}</p>}
      <div className="mt-2 space-y-3">{children}</div>
    </fieldset>
  );
}

/** Changing a column re-reads the file so the value tables below match it. */
function ColumnSelect({ name, value, headers, allowNone }: { name: string; value: string | null; headers: string[]; allowNone?: boolean }) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={`${inlineInputClass} min-w-44`}
    >
      {allowNone && <option value="">— none —</option>}
      {!allowNone && !value && <option value="">Choose a column…</option>}
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );
}

function ValueTable({
  prefix,
  values,
  options,
}: {
  prefix: string;
  values: Record<string, string>;
  options: readonly (readonly [string, string])[];
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-1.5">In the file</th>
            <th className="px-3 py-1.5">Means</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {entries.map(([raw, mapped], i) => (
            <tr key={raw}>
              <td className="px-3 py-1.5 font-mono text-xs text-stone-800">
                {raw === "" ? <span className="italic text-stone-400">(empty)</span> : raw}
                <input type="hidden" name={`${prefix}Key_${i}`} value={raw} />
              </td>
              <td className="px-3 py-1">
                <select name={`${prefix}Val_${i}`} defaultValue={mapped} className={`${inputClass} py-1`}>
                  {options.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Radio({ name, value, checked, onChange, children }: { name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="accent-brand-700" />
      {children}
    </label>
  );
}

export function MappingForm({
  action,
  headers,
  mapping,
}: {
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  headers: string[];
  mapping: Mapping;
}) {
  const [amountMode, setAmountMode] = useState(mapping.amount.mode);
  const [currencyMode, setCurrencyMode] = useState(mapping.amount.mode === "single" ? mapping.amount.currency.mode : "fixed");
  const [tenderMode, setTenderMode] = useState(mapping.tender.mode);
  const [typeMode, setTypeMode] = useState(mapping.type.mode);
  const single = mapping.amount.mode === "single" ? mapping.amount : null;
  const split = mapping.amount.mode === "split" ? mapping.amount : null;

  return (
    <ActionForm action={action} submitLabel="Update preview" pendingLabel="Reading…" variant="secondary" className="space-y-5">
      <Section title="Date" hint="When each sale happened. Late-night sales can count for the day service started.">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className={labelClass}>Column</span>
            <ColumnSelect name="dateColumn" value={mapping.dateColumn} headers={headers} />
          </label>
          <label>
            <span className={labelClass}>Written as</span>
            <select name="dateFormat" defaultValue={mapping.dateFormat} className={inlineInputClass}>
              <option value="auto">Detect automatically</option>
              <option value="DMY">Day first (24/11/2026)</option>
              <option value="MDY">Month first (11/24/2026)</option>
              <option value="YMD">Year first (2026-11-24)</option>
            </select>
          </label>
          <label>
            <span className={labelClass}>Sales before … count for the day before</span>
            <select name="dayCutoffHour" defaultValue={String(mapping.dayCutoffHour)} className={inlineInputClass}>
              <option value="0">Midnight (no carry-over)</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <Section
        title="Record ID"
        hint="The column(s) that make each row unique in the POS, e.g. receipt number + payment line. This is what stops a row being imported twice."
      >
        <div className="flex flex-wrap gap-2">
          {headers.map((h) => (
            <label
              key={h}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
            >
              <input type="checkbox" name="idColumns" value={h} defaultChecked={mapping.idColumns.includes(h)} className="accent-brand-700" />
              {h}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Amount">
        <Radio name="amountMode" value="single" checked={amountMode === "single"} onChange={() => setAmountMode("single")}>
          One amount column
        </Radio>
        {amountMode === "single" && (
          <div className="ml-6 space-y-3">
            <ColumnSelect name="amountColumn" value={single?.column ?? null} headers={headers} />
            <Radio name="currencyMode" value="fixed" checked={currencyMode === "fixed"} onChange={() => setCurrencyMode("fixed")}>
              All amounts are in
              <select
                name="currencyFixed"
                defaultValue={single?.currency.mode === "fixed" ? single.currency.value : "USD"}
                className={inlineInputClass}
              >
                <option value="USD">USD</option>
                <option value="LBP">LBP</option>
              </select>
            </Radio>
            <Radio name="currencyMode" value="column" checked={currencyMode === "column"} onChange={() => setCurrencyMode("column")}>
              The currency is in column
              <ColumnSelect
                name="currencyColumn"
                value={single?.currency.mode === "column" ? single.currency.column : null}
                headers={headers}
              />
            </Radio>
            {currencyMode === "column" && single?.currency.mode === "column" && (
              <>
                <input type="hidden" name="currencyPrevColumn" value={single.currency.column} />
                <ValueTable prefix="currency" values={single.currency.values} options={CURRENCY_OPTIONS} />
              </>
            )}
          </div>
        )}
        <Radio name="amountMode" value="split" checked={amountMode === "split"} onChange={() => setAmountMode("split")}>
          Separate USD and LBP columns (a row can have both)
        </Radio>
        {amountMode === "split" && (
          <div className="ml-6 flex flex-wrap gap-3">
            <label>
              <span className={labelClass}>USD column</span>
              <ColumnSelect name="usdColumn" value={split?.usdColumn ?? null} headers={headers} allowNone />
            </label>
            <label>
              <span className={labelClass}>LBP column</span>
              <ColumnSelect name="lbpColumn" value={split?.lbpColumn ?? null} headers={headers} allowNone />
            </label>
          </div>
        )}
      </Section>

      <Section title="Payment method" hint="Only cash affects what should be in the drawer.">
        <Radio name="tenderMode" value="column" checked={tenderMode === "column"} onChange={() => setTenderMode("column")}>
          From column
          <ColumnSelect name="tenderColumn" value={mapping.tender.mode === "column" ? mapping.tender.column : null} headers={headers} />
        </Radio>
        {tenderMode === "column" && mapping.tender.mode === "column" && (
          <div className="ml-6">
            <input type="hidden" name="tenderPrevColumn" value={mapping.tender.column} />
            <ValueTable prefix="tender" values={mapping.tender.values} options={TENDER_OPTIONS} />
          </div>
        )}
        <Radio name="tenderMode" value="fixed" checked={tenderMode === "fixed"} onChange={() => setTenderMode("fixed")}>
          Everything was paid by
          <select
            name="tenderFixed"
            defaultValue={mapping.tender.mode === "fixed" ? mapping.tender.value : "cash"}
            className={inlineInputClass}
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </Radio>
      </Section>

      <Section title="Line type" hint="Negative payments are treated as refunds automatically.">
        <Radio name="typeMode" value="column" checked={typeMode === "column"} onChange={() => setTypeMode("column")}>
          From column
          <ColumnSelect name="typeColumn" value={mapping.type.mode === "column" ? mapping.type.column : null} headers={headers} />
        </Radio>
        {typeMode === "column" && mapping.type.mode === "column" && (
          <div className="ml-6">
            <input type="hidden" name="typePrevColumn" value={mapping.type.column} />
            <ValueTable prefix="type" values={mapping.type.values} options={TYPE_OPTIONS} />
          </div>
        )}
        <Radio name="typeMode" value="fixed" checked={typeMode === "fixed"} onChange={() => setTypeMode("fixed")}>
          Every row is a payment
          <input type="hidden" name="typeFixed" value="payment" />
        </Radio>
      </Section>
    </ActionForm>
  );
}
