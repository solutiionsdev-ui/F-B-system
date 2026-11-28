// A small menu costing workbook in the same three-sheet layout as a
// restaurant's own costing sheet: made-up dishes and prices, with the kinds of
// problems such sheets have (a sauce with a typed price and its own recipe, a
// missing price, a name used for both a dish and an ingredient, blank lines).
import { strToU8, zipSync } from "fflate";
import type { Sheet } from "@/lib/menu-workbook";
import { recipeTemplate } from "@/lib/recipe-template";

export const SAMPLE_WORKBOOK: Sheet[] = [
  {
    name: "PriceList",
    rows: [
      ["Ingredient", "Pricing Unit (kg/l/unit)", "Price per Unit", "Notes"],
      [" white cheese", "kg", "26.67", "Dairy Co"],
      ["Bread roll ", "unit", "0.41", ""],
      ["olive oil", "L", "8.9", ""],
      ["Garden herb", "unit (30g)", "0.4", "Market"],
      ["lemon", "kg", "1.5", ""],
      ["House dressing", "L", "3.1", ""], // has its own recipe below
      ["flour", "kg", "", ""], // no price
      ["Grilled potato", "kg", "0.8", ""], // a raw ingredient sharing a dish's name
      ["salt", "kg", "0.5", ""],
    ],
  },
  {
    name: "Recipes",
    rows: [
      ["Menu Item", "Ingredient", "Qty", "Qty Unit (g/kg/ml/l/unit)", "Price per Unit (auto)"],
      ["Cheese toast", "bread roll", "1", "unit"],
      ["Cheese toast", "White Cheese", "20", "g"],
      ["Cheese toast", "House dressing", "20", "g"],
      ["Cheese toast", "garden herb", "3", "g"],
      ["Cheese toast", "chives", "2", "g"], // not in the price list
      ["Potato bowl", "Grilled potato", "150", "g"],
      ["Potato bowl", "olive oil", "10", "ml"],
      ["Potato bowl", "flour", "5", "g"],
      ["Potato bowl", "", "", ""], // blank line
      ["Grilled potato", "grilled potato", "200", "g"],
      ["Grilled potato", "salt", "2", "g"],
      ["House dressing", "olive oil", "100", "ml"],
      ["House dressing", "lemon", "50", "g"],
      ["House dressing", "salt", "2", "g"],
      ["", "lemon", "10", "g"], // a line without a dish
      ["Cake", "flour", "200", "cups"], // unknown unit
    ],
  },
  {
    name: "MenuCosts",
    rows: [
      ["Menu Item", "Total Recipe Cost (auto)", "Packaging Cost", "Overhead %", "Target Food Cost %", "Suggested Price", "Selling prices", "", "", "PROFIT"],
      ["Cheese toast", "1.85", "", "0.22", "0.3", "7.5", "8", "", "", "6.1"],
      ["Potato bowl", "0.5", "", "0.22", "0.3", "2.0", "6", "Box", "0.18", "5.5"],
      ["Grilled potato", "0.2", "", "0.22", "0.25", "0.8", "5", "Bag small", "0.2553", "4.8"],
      ["House dressing", "0.4", "", "0.22", "0.3", "1.6", "", "", "0.4353", "-0.4"],
    ],
  },
];

/** The sheets as a real .xlsx file (numbers stored as numbers, text inline), for upload tests. */
export function workbookXlsx(sheets: Sheet[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const col = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  const sheetXml = (rows: string[][]) =>
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              const ref = `${col(ci)}${ri + 1}`;
              if (v === "") return "";
              return /^-?\d+(\.\d+)?$/.test(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}</Relationships>`,
    ),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows))));
  return zipSync(files);
}

/** The template as a restaurant would fill it: same rows, without the "Example – " prefix. */
export function filledTemplate() {
  return recipeTemplate().map((s) =>
    s.name === "How to fill" ? s : { ...s, rows: s.rows.map((r) => r.map((c) => (typeof c === "string" ? c.replace(/^Example – /, "") : c))) },
  );
}
