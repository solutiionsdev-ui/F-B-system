// Turning a POS export into sales lines. Pure functions (no database), so the
// same logic previews and posts, and is easy to test.
//
// Every POS exports differently, so instead of one parser per POS there is a
// *mapping*: which column holds the date, the record ID, the amount, the
// currency, the payment method and the line type, plus how each value in
// those columns translates. A mapping saved under a name is a "POS format".
import type { Tender } from "./closing";
import { parseAmount, MoneyError, type Currency } from "./money";

export type { Tender };
export type LineType = "payment" | "refund" | "discount" | "void" | "tax" | "service_charge";
export type DateFormat = "auto" | "DMY" | "MDY" | "YMD";

export type Mapping = {
  dateColumn: string;
  dateFormat: DateFormat;
  /** Rows timestamped before this hour belong to the previous business day (late-night service). */
  dayCutoffHour: number;
  /** Columns that together identify a row uniquely in the POS (e.g. receipt no. + payment line). */
  idColumns: string[];
  amount:
    | { mode: "single"; column: string; currency: { mode: "fixed"; value: Currency } | { mode: "column"; column: string; values: Record<string, Currency | "skip"> } }
    | { mode: "split"; usdColumn: string | null; lbpColumn: string | null };
  tender: { mode: "fixed"; value: Tender } | { mode: "column"; column: string; values: Record<string, Tender | "skip"> };
  type: { mode: "fixed"; value: LineType } | { mode: "column"; column: string; values: Record<string, LineType | "skip"> };
};

export type NormalizedLine = {
  row: number; // 1-based data row number as shown in a spreadsheet (header is row 1)
  businessDate: string;
  externalRef: string;
  lineType: LineType;
  tender: Tender | null;
  currency: Currency;
  amountMinor: bigint;
};
export type RowProblem = { row: number; problem: string; values: string[] };

export const MAX_ROWS = 20_000;
export const MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------- CSV

/** Parses CSV text: detects , ; or tab, handles quotes, BOM and CRLF. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ",";

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return toTable(records);
}

/** Turns raw records into trimmed headers and rows, dropping blank lines. */
export function toTable(records: unknown[][]): { headers: string[]; rows: string[][] } {
  const clean = records
    .map((r) => r.map(cellText))
    .filter((r) => r.some((c) => c !== ""));
  if (clean.length === 0) throw new Error("The file is empty.");
  const rawHeaders = clean[0];
  const width = Math.max(...clean.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = rawHeaders[i] || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  const rows = clean.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  if (rows.length > MAX_ROWS) throw new Error(`The file has ${rows.length} rows; the limit is ${MAX_ROWS}. Export a shorter period.`);
  return { headers, rows };
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

/** Text for a cell from CSV or Excel (Excel dates come in as Date objects). */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    // Excel stores wall-clock times; read them back in UTC to keep the digits as typed.
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  return String(v).trim();
}

// ---------------------------------------------------------------- suggestions

const find = (headers: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const h = headers.find((x) => p.test(x));
    if (h) return h;
  }
  return null;
};

export function suggestTender(value: string): Tender | "skip" {
  const v = value.toLowerCase();
  // Delivery apps first: their sales are held by the app, never in the drawer.
  if (/toters/.test(v)) return "toters";
  if (/nok\s*nok/.test(v)) return "noknok";
  if (/cash|نقد|كاش/.test(v)) return "cash";
  if (/visa|master|card|credit|debit|amex|tpe|pos\b|بطاقة/.test(v)) return "card";
  if (v === "") return "skip";
  return "other";
}

export function suggestCurrency(value: string): Currency | "skip" {
  const v = value.toLowerCase();
  if (/usd|\$|dollar|دولار/.test(v)) return "USD";
  if (/lbp|l\.?l|lira|livre|ليرة|ل\.ل/.test(v)) return "LBP";
  return "skip";
}

export function suggestType(value: string): LineType | "skip" {
  const v = value.toLowerCase();
  if (/refund|return|مرتجع/.test(v)) return "refund";
  if (/void|cancel/.test(v)) return "void";
  if (/discount|خصم/.test(v)) return "discount";
  if (/vat|tax|ضريبة/.test(v)) return "tax";
  if (/service/.test(v)) return "service_charge";
  if (/paid|sale|payment|settled|closed|complete|ok/.test(v) || v === "") return "payment";
  return "skip";
}

export function distinctValues(headers: string[], rows: string[][], column: string, limit = 40): string[] {
  const i = headers.indexOf(column);
  if (i < 0) return [];
  const set = new Set<string>();
  for (const r of rows) {
    set.add(r[i] ?? "");
    if (set.size > limit) break;
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** A starting mapping guessed from the column names and contents. */
export function suggestMapping(headers: string[], rows: string[][]): Mapping {
  const date = find(headers, /date|time|closed|created|opened|تاريخ/i) ?? headers[0];
  const ids = [
    find(headers, /receipt|check|cheque|bill|order|invoice|ticket|transaction|txn|فاتورة/i),
    find(headers, /line|payment.?(id|no)|seq|split/i),
  ].filter((x): x is string => Boolean(x) && x !== date);
  const usd = find(headers, /usd|\$|dollar/i);
  const lbp = find(headers, /lbp|l\.l|lira|ليرة/i);
  const amountCol = find(headers, /amount|total|paid|value|sum|مبلغ/i);
  const currencyCol = find(headers, /curr|عملة/i);
  const tenderCol = find(headers, /method|tender|payment.?type|pay.?type|payment(?!.?id)|طريقة/i);
  const typeCol = find(headers, /type|status|kind|transaction.?type|نوع/i);

  const valuesFor = <T extends string>(col: string, fn: (v: string) => T) =>
    Object.fromEntries(distinctValues(headers, rows, col).map((v) => [v, fn(v)])) as Record<string, T>;

  const amount: Mapping["amount"] =
    (usd || lbp) && !(amountCol && currencyCol)
      ? { mode: "split", usdColumn: usd, lbpColumn: lbp }
      : {
          mode: "single",
          column: amountCol ?? headers[headers.length - 1],
          currency: currencyCol
            ? { mode: "column", column: currencyCol, values: valuesFor(currencyCol, suggestCurrency) }
            : { mode: "fixed", value: "USD" },
        };

  return {
    dateColumn: date,
    dateFormat: "auto",
    dayCutoffHour: 5,
    idColumns: ids.length ? [...new Set(ids)] : [],
    amount,
    tender: tenderCol && tenderCol !== typeCol
      ? { mode: "column", column: tenderCol, values: valuesFor(tenderCol, suggestTender) }
      : { mode: "fixed", value: "cash" },
    type: typeCol && typeCol !== tenderCol
      ? { mode: "column", column: typeCol, values: valuesFor(typeCol, suggestType) }
      : { mode: "fixed", value: "payment" },
  };
}

// ---------------------------------------------------------------- dates

/** Guesses DMY vs MDY from the values themselves (a first part over 12 must be a day). */
export function detectDateFormat(values: string[]): Exclude<DateFormat, "auto"> {
  let dmy = false;
  let mdy = false;
  for (const v of values.slice(0, 500)) {
    if (/^\d{4}[-/.]/.test(v)) return "YMD";
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(v);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (mdy && !dmy) return "MDY";
  return "DMY"; // Lebanon writes day first
}

/** Business date for a cell, moving late-night times back to the previous day. */
export function businessDateOf(value: string, format: Exclude<DateFormat, "auto">, cutoffHour: number): string | null {
  const v = value.trim();
  let y: number, mo: number, d: number;
  let rest = "";
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(v);
  if (m && format === "YMD") {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/.exec(v)) && format !== "YMD") {
    const a = Number(m[1]);
    const b = Number(m[2]);
    [d, mo] = format === "DMY" ? [a, b] : [b, a];
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    rest = m[4];
  } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(v))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else return null;

  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;

  const t = /[T\s](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?/i.exec(rest);
  if (t) {
    let hour = Number(t[1]);
    const ampm = t[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (hour < cutoffHour) dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- amounts

/** Parses an exported amount: "1,250.50", "-12", "(12.00)", "$18.5", "450 000 LBP". */
export function parseExportAmount(raw: string, currency: Currency): { minor: bigint; negative: boolean } | null {
  let v = raw.trim();
  if (v === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[$€£]|usd|lbp|l\.l\.?|ل\.ل/gi, "").trim();
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.endsWith("-")) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  try {
    return { minor: parseAmount(v, currency), negative };
  } catch (e) {
    if (e instanceof MoneyError) return null;
    throw e;
  }
}

// ---------------------------------------------------------------- normalize

const TENDER_TYPES: LineType[] = ["payment", "refund"];

/**
 * Applies a mapping to every row. Rows that a value mapping says to skip are
 * counted, rows that can't be read become problems, and rows whose ID
 * repeats within the file are reported (only the first is kept).
 */
export function normalizeRows(headers: string[], rows: string[][], mapping: Mapping) {
  const col = (name: string | null | undefined) => (name ? headers.indexOf(name) : -1);
  const dateIdx = col(mapping.dateColumn);
  const idIdx = mapping.idColumns.map(col);
  const problems: RowProblem[] = [];
  const lines: NormalizedLine[] = [];
  let skipped = 0;
  let duplicatesInFile = 0;
  const seen = new Set<string>();

  const setup: string[] = [];
  if (dateIdx < 0) setup.push("Pick the date column.");
  if (idIdx.length === 0 || idIdx.some((i) => i < 0)) setup.push("Pick at least one ID column (e.g. receipt number).");
  if (mapping.amount.mode === "single" && col(mapping.amount.column) < 0) setup.push("Pick the amount column.");
  if (mapping.amount.mode === "split" && col(mapping.amount.usdColumn) < 0 && col(mapping.amount.lbpColumn) < 0)
    setup.push("Pick the USD and/or LBP amount column.");
  if (mapping.amount.mode === "single" && mapping.amount.currency.mode === "column" && col(mapping.amount.currency.column) < 0)
    setup.push("Pick the currency column.");
  if (mapping.tender.mode === "column" && col(mapping.tender.column) < 0) setup.push("Pick the payment-method column.");
  if (mapping.type.mode === "column" && col(mapping.type.column) < 0) setup.push("Pick the line-type column.");
  if (setup.length) return { lines, problems, skipped, duplicatesInFile, setup, dateFormat: "DMY" as const };

  const format = mapping.dateFormat === "auto" ? detectDateFormat(rows.map((r) => r[dateIdx])) : mapping.dateFormat;

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const problem = (p: string) => problems.push({ row: rowNo, problem: p, values: r });

    const idParts = idIdx.map((j) => r[j]?.trim() ?? "");
    if (idParts.every((p) => p === "")) return problem("No record ID");
    const baseRef = idParts.join("|");

    let lineType: LineType;
    if (mapping.type.mode === "fixed") lineType = mapping.type.value;
    else {
      const raw = r[col(mapping.type.column)] ?? "";
      const t = mapping.type.values[raw];
      if (t === undefined) return problem(`Line type "${raw}" isn't mapped`);
      if (t === "skip") {
        skipped++;
        return;
      }
      lineType = t;
    }

    let tender: Tender | null = null;
    if (mapping.tender.mode === "fixed") tender = mapping.tender.value;
    else {
      const raw = r[col(mapping.tender.column)] ?? "";
      const t = mapping.tender.values[raw];
      if (t === undefined) return problem(`Payment method "${raw}" isn't mapped`);
      if (t === "skip") {
        if (TENDER_TYPES.includes(lineType)) {
          skipped++;
          return;
        }
      } else tender = t;
    }

    const date = businessDateOf(r[dateIdx] ?? "", format, mapping.dayCutoffHour);
    if (!date) return problem(`Can't read the date "${r[dateIdx] ?? ""}"`);

    const parts: { currency: Currency; raw: string; suffix: string }[] = [];
    if (mapping.amount.mode === "single") {
      let currency: Currency;
      if (mapping.amount.currency.mode === "fixed") currency = mapping.amount.currency.value;
      else {
        const raw = r[col(mapping.amount.currency.column)] ?? "";
        const c = mapping.amount.currency.values[raw];
        if (c === undefined) return problem(`Currency "${raw}" isn't mapped`);
        if (c === "skip") {
          skipped++;
          return;
        }
        currency = c;
      }
      parts.push({ currency, raw: r[col(mapping.amount.column)] ?? "", suffix: "" });
    } else {
      if (mapping.amount.usdColumn) parts.push({ currency: "USD", raw: r[col(mapping.amount.usdColumn)] ?? "", suffix: "|USD" });
      if (mapping.amount.lbpColumn) parts.push({ currency: "LBP", raw: r[col(mapping.amount.lbpColumn)] ?? "", suffix: "|LBP" });
    }

    const rowLines: NormalizedLine[] = [];
    for (const p of parts) {
      if (mapping.amount.mode === "split" && p.raw.trim() === "") continue;
      const parsed = parseExportAmount(p.raw, p.currency);
      if (!parsed) return problem(`Can't read the ${p.currency} amount "${p.raw}"`);
      if (parsed.minor === 0n) continue;
      let type = lineType;
      // A negative payment is money going back to the customer.
      if (parsed.negative && type === "payment") type = "refund";
      rowLines.push({
        row: rowNo,
        businessDate: date,
        externalRef: baseRef + p.suffix,
        lineType: type,
        tender: TENDER_TYPES.includes(type) ? (tender ?? "other") : null,
        currency: p.currency,
        amountMinor: parsed.minor,
      });
    }
    if (rowLines.length === 0) {
      skipped++;
      return;
    }
    for (const l of rowLines) {
      if (seen.has(l.externalRef)) {
        duplicatesInFile++;
        continue;
      }
      seen.add(l.externalRef);
      lines.push(l);
    }
  });

  return { lines, problems, skipped, duplicatesInFile, setup, dateFormat: format };
}

/**
 * Fills in suggestions for column values the mapping hasn't seen yet (a saved
 * POS format meeting a new payment method, say). They show up pre-filled in
 * the form, so nothing is mapped without the person seeing it.
 */
export function completeMapping(mapping: Mapping, headers: string[], rows: string[][]): Mapping {
  const fill = <T extends string>(column: string, values: Record<string, T>, suggest: (v: string) => T) => {
    const out = { ...values };
    for (const v of distinctValues(headers, rows, column)) if (!(v in out)) out[v] = suggest(v);
    return out;
  };
  const m: Mapping = structuredClone(mapping);
  if (m.tender.mode === "column") m.tender.values = fill(m.tender.column, m.tender.values, suggestTender);
  if (m.type.mode === "column") m.type.values = fill(m.type.column, m.type.values, suggestType);
  if (m.amount.mode === "single" && m.amount.currency.mode === "column")
    m.amount.currency.values = fill(m.amount.currency.column, m.amount.currency.values, suggestCurrency);
  return m;
}

/** Checks a mapping received from a form or the database has the right shape. */
export function isMapping(m: unknown): m is Mapping {
  if (!m || typeof m !== "object") return false;
  const x = m as Partial<Mapping>;
  return (
    typeof x.dateColumn === "string" &&
    Array.isArray(x.idColumns) &&
    typeof x.dayCutoffHour === "number" &&
    !!x.amount &&
    !!x.tender &&
    !!x.type
  );
}

// ---------------------------------------------------------------- Omega (demo mapping)

/**
 * A saved format for the Omega "Daily Sales & Payment Export". This mapping is
 * built from our own sample file, not from a real Omega export: Omega layouts
 * differ by version and configuration (spec 8.1), so it is labelled as a demo
 * mapping until it has been checked against a real file.
 */
export const OMEGA_FORMAT_NAME = "Omega POS — Daily Sales & Payment Export";
export const OMEGA_FORMAT_NOTE = "Demo mapping v1.0 for .csv / .xlsx. Built from the sample file; confirm against a real Omega export.";
export const OMEGA_DEMO_MAPPING: Mapping = {
  dateColumn: "Date Time",
  dateFormat: "DMY",
  dayCutoffHour: 5,
  idColumns: ["Receipt No", "Line"],
  amount: { mode: "single", column: "Amount", currency: { mode: "column", column: "Currency", values: { USD: "USD", LBP: "LBP" } } },
  tender: { mode: "column", column: "Payment Method", values: { Cash: "cash", Card: "card", Toters: "toters", NokNok: "noknok", "": "skip" } },
  type: { mode: "column", column: "Line Type", values: { Sale: "payment", Refund: "refund", Discount: "discount", Void: "void", VAT: "tax" } },
};
