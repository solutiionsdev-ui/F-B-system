// Reading past business days from Excel (a restaurant moving its history into
// FINCTRL instead of re-typing it). Pure: turns the sheets into a plan of
// days (sales, expenses, cash movements, opening float, the cash counted at
// close) plus every issue found. The server matches branches and categories
// and posts each day through the same rules as Daily Close.
//
// Sheets: Days (one row per branch and date), Expenses and Cash movements
// (one row each, by branch and date). Rows whose branch starts with
// "Example" show how to fill the template and are skipped.
import type { Tender } from "./closing";
import { cleanName, decimalToScaled, type Issue, type IssueLevel, type Sheet } from "./menu-workbook";
import type { Currency } from "./money";

export type Amounts = { USD: string; LBP: string };
export type SalesKey = Tender | "cashRefunds" | "discounts" | "voids" | "tax";

export type HistoryExpense = { row: number; category: string; amount: string; currency: Currency; paidFrom: "drawer" | "bank"; supplier: string; note: string };
export type HistoryMovement = { row: number; kind: "safe_drop" | "partner_withdrawal"; amount: string; currency: Currency; partnerName: string; note: string };

export type HistoryDay = {
  key: string;
  branch: string;
  date: string;
  row: number;
  float: Amounts;
  sales: Partial<Record<SalesKey, Amounts>>;
  counted: Amounts | null;
  /** A difference reason code (lib/closing's list), or null. */
  reason: string | null;
  note: string;
  expenses: HistoryExpense[];
  movements: HistoryMovement[];
};

export type HistoryPlan = { days: HistoryDay[]; issues: Issue[] };

export const REASON_CODES: Record<string, string> = {
  counting_error: "Counting error",
  unrecorded_expense: "Unrecorded expense",
  change_shortage: "Change given wrongly",
  rate_rounding: "Exchange-rate rounding",
  suspected_loss: "Suspected loss",
  other: "Other",
};

const isExample = (s: string) => /^example\b/i.test(s.trim());
const keyOf = (branch: string, date: string) => `${cleanName(branch).toLowerCase()}|${date}`;

/** A date as written: 2026-11-26, 26/11/2026 (day first, as in Lebanon), or an Excel date. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])];
  else if (/^\d{5}(\.0+)?$/.test(s)) {
    // An Excel date serial (days since 30 Dec 1899).
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86_400_000);
    return date.toISOString().slice(0, 10);
  } else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Minor units as a string: cents for USD, whole pounds for LBP. Blank is zero; text is null. */
function money(raw: string, currency: Currency): string | null {
  if (!raw.trim()) return "0";
  const v = decimalToScaled(raw.replace(/[$,\s]|usd|lbp|l\.l\.?/gi, ""), currency === "USD" ? 2 : 0);
  return v == null ? null : v.toString();
}

function sheetOf(sheets: Sheet[], names: string[]) {
  return sheets.find((s) => names.includes(s.name.toLowerCase().replace(/[\s_-]/g, "")));
}

function headerIndex(header: string[]) {
  const norm = header.map((h) => (h ?? "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  return (re: RegExp) => norm.findIndex((h) => re.test(h));
}

const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").toString() : "");

const TENDER_COLUMNS: { key: SalesKey; re: string }[] = [
  { key: "cashRefunds", re: "(cash )?refunds?" },
  { key: "cash", re: "cash( sales)?" },
  { key: "card", re: "card" },
  { key: "toters", re: "toters" },
  { key: "noknok", re: "noknok|nok nok" },
  { key: "other", re: "other( payments)?" },
  { key: "discounts", re: "discounts?" },
  { key: "voids", re: "voids?" },
  { key: "tax", re: "vat|tax" },
];

export function readHistoryWorkbook(sheets: Sheet[], today: string): HistoryPlan {
  const issues: Issue[] = [];
  const issue = (level: IssueLevel, sheet: string, row: number | null, subject: string, message: string) => issues.push({ level, sheet, row, subject, message });
  const daysSheet = sheetOf(sheets, ["days", "pastdays", "dailysales", "sales"]);
  if (!daysSheet) throw new Error("This doesn't look like a past-days workbook: it needs a Days sheet (date, branch, sales, cash counted).");
  let examples = 0;

  // ---- days
  const col = headerIndex(daysSheet.rows[0] ?? []);
  const dc = {
    date: col(/^(business )?date$/),
    branch: col(/^(branch|location|venue)$/),
    floatUSD: col(/^opening float usd$/),
    floatLBP: col(/^opening float lbp$/),
    countedUSD: col(/^counted usd$/),
    countedLBP: col(/^counted lbp$/),
    reason: col(/^difference reason$/),
    note: col(/^note|explanation/),
  };
  if (dc.date < 0 || dc.branch < 0) throw new Error(`The ${daysSheet.name} sheet needs Date and Branch columns.`);
  const salesCols: { key: SalesKey; USD: number; LBP: number }[] = TENDER_COLUMNS.map((t) => ({
    key: t.key,
    USD: col(new RegExp(`^(${t.re}) usd$`)),
    LBP: col(new RegExp(`^(${t.re}) lbp$`)),
  }));
  if (!salesCols.some((c) => c.USD >= 0 || c.LBP >= 0)) throw new Error(`The ${daysSheet.name} sheet needs sales columns such as "Cash USD" and "Card USD".`);

  const days = new Map<string, HistoryDay>();
  daysSheet.rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const branch = cleanName(cell(r, dc.branch));
    const dateRaw = cell(r, dc.date);
    if (!branch && !dateRaw.trim()) return;
    if (isExample(branch)) {
      examples++;
      return;
    }
    const subject = `${branch || "?"} ${dateRaw.trim()}`.trim();
    if (!branch) return issue("error", daysSheet.name, row, subject, "No branch; row skipped.");
    const date = parseDate(dateRaw);
    if (!date) return issue("error", daysSheet.name, row, subject, `"${dateRaw.trim()}" isn't a date FINCTRL can read (use 2026-11-26 or 26/11/2026); row skipped.`);
    if (date > today) return issue("error", daysSheet.name, row, subject, "Date is in the future; row skipped.");
    const key = keyOf(branch, date);
    if (days.has(key)) return issue("error", daysSheet.name, row, subject, `Same branch and date as row ${days.get(key)!.row}; row skipped.`);

    const amounts = (usdIdx: number, lbpIdx: number, label: string): Amounts | null => {
      const USD = money(cell(r, usdIdx), "USD");
      const LBP = money(cell(r, lbpIdx), "LBP");
      if (USD == null || LBP == null || BigInt(USD) < 0n || BigInt(LBP) < 0n) {
        issue("error", daysSheet.name, row, subject, `${label}: not a valid amount; row skipped.`);
        return null;
      }
      return { USD, LBP };
    };
    const float = amounts(dc.floatUSD, dc.floatLBP, "Opening float");
    if (!float) return;
    const sales: HistoryDay["sales"] = {};
    for (const c of salesCols) {
      if (c.USD < 0 && c.LBP < 0) continue;
      const a = amounts(c.USD, c.LBP, c.key);
      if (!a) return;
      if (a.USD !== "0" || a.LBP !== "0") sales[c.key] = a;
    }
    let counted: Amounts | null = null;
    const cu = cell(r, dc.countedUSD).trim();
    const cl = cell(r, dc.countedLBP).trim();
    if (cu || cl) {
      if (!cu || !cl) {
        issue("warning", daysSheet.name, row, subject, "Only one currency was counted; the day is left open to count the other and close.");
      } else {
        counted = amounts(dc.countedUSD, dc.countedLBP, "Counted cash");
        if (!counted) return;
      }
    }
    const reasonRaw = cell(r, dc.reason).trim().toLowerCase();
    const reason = reasonRaw
      ? (Object.entries(REASON_CODES).find(([code, label]) => code === reasonRaw.replace(/\s+/g, "_") || label.toLowerCase() === reasonRaw)?.[0] ?? "other")
      : null;
    if (reasonRaw && reason === "other" && reasonRaw !== "other") issue("info", daysSheet.name, row, subject, `Difference reason "${reasonRaw}" isn't in the list; recorded as Other.`);
    days.set(key, { key, branch, date, row, float, sales, counted, reason, note: cell(r, dc.note).trim(), expenses: [], movements: [] });
  });

  // ---- expenses
  const expSheet = sheetOf(sheets, ["expenses", "operatingexpenses"]);
  if (expSheet) {
    const c = headerIndex(expSheet.rows[0] ?? []);
    const ec = {
      date: c(/^(business )?date$/),
      branch: c(/^(branch|location|venue)$/),
      category: c(/^category$/),
      amount: c(/^amount$/),
      currency: c(/^currency$/),
      paidFrom: c(/^paid (from|with)|payment source/),
      supplier: c(/^supplier|employee|vendor/),
      note: c(/^note|what for|description/),
    };
    expSheet.rows.slice(1).forEach((r, i) => {
      const row = i + 2;
      const branch = cleanName(cell(r, ec.branch));
      const dateRaw = cell(r, ec.date);
      if (!branch && !dateRaw.trim() && !cell(r, ec.amount).trim()) return;
      if (isExample(branch)) {
        examples++;
        return;
      }
      const date = parseDate(dateRaw);
      const subject = `${branch || "?"} ${date ?? dateRaw.trim()}`.trim();
      const day = date ? days.get(keyOf(branch, date)) : undefined;
      if (!day) return issue("error", expSheet.name, row, subject, "No matching row (same branch and date) in the Days sheet; expense skipped.");
      const currency = /lbp|l\.?l/i.test(cell(r, ec.currency)) ? "LBP" : /usd|\$|^$/i.test(cell(r, ec.currency).trim()) ? "USD" : null;
      if (!currency) return issue("error", expSheet.name, row, subject, `Currency "${cell(r, ec.currency)}" should be USD or LBP; expense skipped.`);
      const amount = money(cell(r, ec.amount), currency);
      if (amount == null || BigInt(amount) <= 0n) return issue("error", expSheet.name, row, subject, "Amount must be more than zero; expense skipped.");
      const category = cleanName(cell(r, ec.category));
      if (!category) return issue("error", expSheet.name, row, subject, "No category; expense skipped.");
      const note = cell(r, ec.note).trim();
      if (!note) return issue("error", expSheet.name, row, subject, "Every expense needs a note saying what it was for; expense skipped.");
      const paidFrom = /bank|whish|transfer|card/i.test(cell(r, ec.paidFrom)) ? "bank" : "drawer";
      day.expenses.push({ row, category, amount, currency, paidFrom, supplier: cleanName(cell(r, ec.supplier)), note });
    });
  }

  // ---- cash movements
  const movSheet = sheetOf(sheets, ["cashmovements", "movements"]);
  if (movSheet) {
    const c = headerIndex(movSheet.rows[0] ?? []);
    const mc = {
      date: c(/^(business )?date$/),
      branch: c(/^(branch|location|venue)$/),
      type: c(/^type$/),
      amount: c(/^amount$/),
      currency: c(/^currency$/),
      partner: c(/^partner/),
      note: c(/^note|reason/),
    };
    movSheet.rows.slice(1).forEach((r, i) => {
      const row = i + 2;
      const branch = cleanName(cell(r, mc.branch));
      const dateRaw = cell(r, mc.date);
      if (!branch && !dateRaw.trim() && !cell(r, mc.amount).trim()) return;
      if (isExample(branch)) {
        examples++;
        return;
      }
      const date = parseDate(dateRaw);
      const subject = `${branch || "?"} ${date ?? dateRaw.trim()}`.trim();
      const day = date ? days.get(keyOf(branch, date)) : undefined;
      if (!day) return issue("error", movSheet.name, row, subject, "No matching row (same branch and date) in the Days sheet; movement skipped.");
      const type = cell(r, mc.type).toLowerCase();
      const kind = /partner|withdraw/.test(type) ? "partner_withdrawal" : /safe|deposit|bank/.test(type) ? "safe_drop" : null;
      if (!kind) return issue("error", movSheet.name, row, subject, `Type "${cell(r, mc.type)}" should be Safe drop / bank deposit or Partner withdrawal; movement skipped.`);
      const currency = /lbp|l\.?l/i.test(cell(r, mc.currency)) ? "LBP" : "USD";
      const amount = money(cell(r, mc.amount), currency);
      if (amount == null || BigInt(amount) <= 0n) return issue("error", movSheet.name, row, subject, "Amount must be more than zero; movement skipped.");
      const partnerName = cleanName(cell(r, mc.partner));
      if (kind === "partner_withdrawal" && !partnerName) return issue("error", movSheet.name, row, subject, "A partner withdrawal needs the partner's name; movement skipped.");
      day.movements.push({ row, kind, amount, currency, partnerName, note: cell(r, mc.note).trim() });
    });
  }

  if (examples) issues.push({ level: "info", sheet: daysSheet.name, row: null, subject: "Examples", message: `${examples} example row${examples === 1 ? "" : "s"} (branch starting with "Example") skipped.` });
  return { days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.branch.localeCompare(b.branch))), issues };
}
