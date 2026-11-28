// The Excel template for bringing past business days into FINCTRL: one row
// per branch and day (sales, opening float, cash counted at close), with the
// day's expenses and cash movements on their own sheets. Rows whose branch
// starts with "Example" show how to fill it and are skipped on import.
import type { WriteSheet } from "./xlsx-writer";

export const HISTORY_TEMPLATE_FILE = "finctrl-past-days-template.xlsx";

export const HISTORY_HEADERS = {
  days: [
    "Date",
    "Branch",
    "Opening float USD",
    "Opening float LBP",
    "Cash USD",
    "Cash LBP",
    "Card USD",
    "Card LBP",
    "Toters USD",
    "NokNok USD",
    "Cash refunds USD",
    "Cash refunds LBP",
    "Counted USD",
    "Counted LBP",
    "Difference reason",
    "Note",
  ],
  expenses: ["Date", "Branch", "Category", "Amount", "Currency", "Paid from", "Supplier or employee", "Note"],
  movements: ["Date", "Branch", "Type", "Amount", "Currency", "Partner name", "Note"],
};

export function historyTemplate(): WriteSheet[] {
  return [
    {
      name: "How to fill",
      widths: [120],
      rows: [
        ["FINCTRL: import past business days"],
        ["Fill in the sheets, save as .xlsx, then upload it in FINCTRL: Settings & Log → Past days. Owners only."],
        ["You see what each day will become before anything is saved. Days that already exist in FINCTRL are never changed."],
        [""],
        ["1. Days: one row per branch and date. The branch name must match FINCTRL exactly (for example Gemmayzeh Bistro)."],
        ["   Dates as 2026-11-26 or 26/11/2026 (day first). Amounts in their own currency: USD with cents, LBP in whole pounds."],
        ["   Opening float: the cash in the drawer at the start. Sales: what the POS Z report says, by payment type."],
        ["   Counted USD / LBP: the cash counted at close. With both counts, the day is closed; without them it stays open to count."],
        ["   If the count doesn't match what was expected, write what happened in Note and pick a Difference reason:"],
        ["   Counting error, Unrecorded expense, Change given wrongly, Exchange-rate rounding, Suspected loss or Other."],
        ["   A day with a difference and no note is left open for someone to explain and close, as in Daily Close."],
        ["2. Expenses: one row per operating expense, with the same date and branch as its day."],
        ["   Category: one of Salaries & Wages, Food & Kitchen Suppliers, Beverage, Coffee & Bar Suppliers, Generator & Electricity,"],
        ["   Rent & Municipal Fees, Packaging & Delivery Supplies, Cleaning, Maintenance & Repairs, Miscellaneous / Petty Cash."],
        ["   Paid from: Cash drawer or Bank / Whish (only cash-drawer payments change the cash expected in the drawer). A note is required."],
        ["3. Cash movements: safe drops / bank deposits and partner withdrawals (with the partner's name). They're not expenses."],
        ["4. Rows whose branch starts with \"Example\" show how to fill the sheets and are skipped. Delete them or leave them."],
      ],
    },
    {
      name: "Days",
      widths: [12, 26, 12, 14, 10, 14, 10, 12, 10, 10, 12, 14, 12, 14, 20, 46],
      rows: [
        HISTORY_HEADERS.days,
        // Balanced: USD 150 + 420 − 30 bread − 200 safe drop = 340; LBP 2,000,000 + 3,500,000 − 450,000 generator = 5,050,000.
        ["2026-11-02", "Example – Main branch", 150, 2000000, 420, 3500000, 610, 0, 140, 60, 0, 0, 340, 5050000, "", ""],
        // Short and explained: USD 150 + 380 − 12 refund = 518 expected, 480 counted; LBP 4,900,000 expected, 4,800,000 counted.
        [
          "2026-11-03",
          "Example – Main branch",
          150,
          2000000,
          380,
          2900000,
          540,
          900000,
          95,
          40,
          12,
          0,
          480,
          4800000,
          "Unrecorded expense",
          "Plumber paid from the drawer, receipt found later",
        ],
      ],
    },
    {
      name: "Expenses",
      widths: [12, 26, 30, 12, 10, 16, 24, 40],
      rows: [
        HISTORY_HEADERS.expenses,
        ["2026-11-02", "Example – Main branch", "Food & Kitchen Suppliers", 30, "USD", "Cash drawer", "Bakery", "Bread delivery"],
        ["2026-11-02", "Example – Main branch", "Generator & Electricity", 450000, "LBP", "Cash drawer", "Generator owner", "Generator subscription, weekly"],
        ["2026-11-03", "Example – Main branch", "Salaries & Wages", 120, "USD", "Bank / Whish", "Kitchen team", "Weekly wages"],
      ],
    },
    {
      name: "Cash movements",
      widths: [12, 26, 26, 12, 10, 18, 30],
      rows: [HISTORY_HEADERS.movements, ["2026-11-02", "Example – Main branch", "Safe drop / bank deposit", 200, "USD", "", "Evening drop to the safe"]],
    },
  ];
}
