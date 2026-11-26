// The sample "Omega POS — Daily Sales & Payment Export" offered on the POS
// Import page. Fictional, and the same every time for a given date: one
// evening's receipts with cash in USD and LBP, cards, Toters and NokNok, a
// split payment, a discount, a void, a cash refund, VAT lines and two sales
// after midnight (which belong to the same business day).
//
// Totals for one file: cash $218.00 and LBP 4,485,000; card $506.50;
// Toters $94.00; NokNok $50.00; refund $12.00; discount $5.00; void $18.00.
import { toCsv } from "./csv";

type Line = { time: string; nextDay?: boolean; type: "Sale" | "Refund" | "Discount" | "Void"; method?: string; currency: "USD" | "LBP"; amount: string };

/** One entry per receipt; a receipt can have several lines. */
const RECEIPTS: Line[][] = [
  [{ time: "12:10", type: "Sale", method: "Cash", currency: "USD", amount: "18.50" }],
  [{ time: "12:25", type: "Sale", method: "Card", currency: "USD", amount: "42.00" }],
  [{ time: "12:40", type: "Sale", method: "Cash", currency: "LBP", amount: "1345500" }],
  [
    { time: "13:05", type: "Sale", method: "Cash", currency: "USD", amount: "20.00" },
    { time: "13:05", type: "Sale", method: "Card", currency: "USD", amount: "35.00" },
  ],
  [{ time: "13:20", type: "Sale", method: "Toters", currency: "USD", amount: "27.50" }],
  [{ time: "13:45", type: "Sale", method: "Card", currency: "USD", amount: "64.00" }],
  [{ time: "14:10", type: "Sale", method: "Cash", currency: "USD", amount: "12.00" }],
  [{ time: "14:30", type: "Sale", method: "NokNok", currency: "USD", amount: "31.00" }],
  [
    { time: "15:00", type: "Sale", method: "Card", currency: "USD", amount: "23.50" },
    { time: "15:00", type: "Discount", currency: "USD", amount: "5.00" },
  ],
  [{ time: "15:20", type: "Sale", method: "Cash", currency: "LBP", amount: "897000" }],
  [{ time: "16:05", type: "Sale", method: "Toters", currency: "USD", amount: "44.00" }],
  [{ time: "17:15", type: "Void", currency: "USD", amount: "18.00" }],
  [{ time: "18:10", type: "Sale", method: "Card", currency: "USD", amount: "88.00" }],
  [{ time: "18:40", type: "Sale", method: "Cash", currency: "USD", amount: "36.00" }],
  [{ time: "19:05", type: "Sale", method: "Cash", currency: "USD", amount: "54.50" }],
  [{ time: "19:30", type: "Sale", method: "Card", currency: "USD", amount: "120.00" }],
  [{ time: "20:15", type: "Sale", method: "Toters", currency: "USD", amount: "22.50" }],
  [{ time: "20:45", type: "Sale", method: "NokNok", currency: "USD", amount: "19.00" }],
  [{ time: "21:30", type: "Sale", method: "Cash", currency: "USD", amount: "47.00" }],
  [{ time: "22:10", type: "Sale", method: "Card", currency: "USD", amount: "76.00" }],
  [{ time: "22:40", type: "Refund", method: "Cash", currency: "USD", amount: "12.00" }],
  [{ time: "23:20", type: "Sale", method: "Cash", currency: "LBP", amount: "2242500" }],
  [{ time: "00:20", nextDay: true, type: "Sale", method: "Card", currency: "USD", amount: "58.00" }],
  [{ time: "00:45", nextDay: true, type: "Sale", method: "Cash", currency: "USD", amount: "30.00" }],
];

export const OMEGA_SAMPLE_HEADERS = ["Receipt No", "Line", "Date Time", "Line Type", "Payment Method", "Currency", "Amount"];

function dmy(iso: string, addDays = 0) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  const [y, m, day] = d.toISOString().slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

/** VAT at 11% included in a USD sale amount, in cents (integer maths). */
function vatIncluded(amount: string) {
  const cents = BigInt(amount.replace(".", ""));
  const vat = (cents * 11n + 55n) / 111n;
  return `${vat / 100n}.${(vat % 100n).toString().padStart(2, "0")}`;
}

/** The sample's rows for a business date (ISO), without the header. */
export function omegaSampleRows(businessDate: string): string[][] {
  const rows: string[][] = [];
  const stamp = businessDate.replaceAll("-", "").slice(2);
  RECEIPTS.forEach((lines, i) => {
    const receipt = `OM-${stamp}-${String(i + 1).padStart(3, "0")}`;
    let n = 0;
    for (const l of lines) {
      const when = `${dmy(businessDate, l.nextDay ? 1 : 0)} ${l.time}`;
      rows.push([receipt, String(++n), when, l.type, l.method ?? "", l.currency, l.amount]);
      // Each USD sale also reports the VAT inside it, as its own line.
      if (l.type === "Sale" && l.currency === "USD") rows.push([receipt, String(++n), when, "VAT", "", "USD", vatIncluded(l.amount)]);
    }
  });
  return rows;
}

export function omegaSampleCsv(businessDate: string): string {
  return toCsv(OMEGA_SAMPLE_HEADERS, omegaSampleRows(businessDate));
}
