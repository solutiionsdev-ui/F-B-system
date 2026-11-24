// CSV that opens cleanly in Excel and Google Sheets: UTF-8 with a BOM (so
// "Café" isn't garbled), CRLF line endings, quoted where needed. Text cells
// that start like a formula are prefixed with ' so a spreadsheet won't run
// them. Numbers are passed as `num(...)` and written as-is.

export type NumCell = { readonly num: string };
export type Cell = string | NumCell | boolean | null | undefined;

export const num = (value: string | number | bigint): NumCell => ({ num: String(value) });

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(cell: Cell): string {
  if (cell == null) return "";
  let s: string;
  if (typeof cell === "object") s = cell.num;
  else if (typeof cell === "boolean") s = cell ? "yes" : "no";
  else s = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
