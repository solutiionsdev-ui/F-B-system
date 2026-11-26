// Reading POS exports that arrive as PDF, and Google Sheets links. A PDF
// table must come back exactly as the same export would as CSV, so the same
// column matching and the same totals apply.
import { describe, expect, it } from "vitest";
import { OMEGA_SAMPLE_HEADERS, omegaSampleCsv, omegaSampleRows } from "@/lib/omega-sample";
import { googleSheetCsvUrl, tableFromPdfItems } from "@/lib/pdf-table";
import { normalizeRows, OMEGA_DEMO_MAPPING, parseCsv } from "@/lib/pos-import";
import { readUpload } from "@/server/pos-import";
import { omegaSamplePdf, renderPdf } from "./pdf-fixture";

const DATE = "2026-11-13";

describe("PDF exports", () => {
  it("reads a two-page Omega PDF into exactly the rows of the CSV export", async () => {
    const pdf = await omegaSamplePdf(DATE);
    const t = await readUpload("omega-sales.pdf", pdf);
    expect(t.headers).toEqual(OMEGA_SAMPLE_HEADERS);
    // Title, page numbers, the repeated header and the total line are left out.
    expect(t.rows).toEqual(omegaSampleRows(DATE));
  });

  it("gives the same sales lines and totals as the CSV, through the same mapping", async () => {
    const fromPdf = await readUpload("omega-sales.pdf", await omegaSamplePdf(DATE));
    const csv = parseCsv(omegaSampleCsv(DATE));
    const a = normalizeRows(fromPdf.headers, fromPdf.rows, OMEGA_DEMO_MAPPING);
    const b = normalizeRows(csv.headers, csv.rows, OMEGA_DEMO_MAPPING);
    expect(a.problems).toEqual([]);
    expect(a.lines).toEqual(b.lines);
  });

  it("recognises a PDF by its contents even without the .pdf name", async () => {
    const t = await readUpload("export", await omegaSamplePdf(DATE));
    expect(t.headers).toEqual(OMEGA_SAMPLE_HEADERS);
  });

  it("refuses a scan (no text) and a summary with no table, saying what to do instead", async () => {
    const scan = await renderPdf((doc) => doc.rect(50, 50, 300, 200).fill("#888"));
    await expect(readUpload("scan.pdf", scan)).rejects.toThrow(/no readable text/);
    const summary = await renderPdf((doc) => {
      doc.fontSize(12).text("Z report", 50, 50, { lineBreak: false });
      doc.text("Cash USD", 50, 80, { lineBreak: false }).text("218.00", 300, 80, { lineBreak: false });
      doc.text("Card", 50, 100, { lineBreak: false }).text("506.50", 300, 100, { lineBreak: false });
    });
    await expect(readUpload("z-report.pdf", summary)).rejects.toThrow(/no table of sales lines/);
  });

  it("keeps a cell split into pieces together and puts right-aligned numbers under their column", () => {
    const t = tableFromPdfItems([
      { str: "Item", x: 10, y: 700, width: 30, page: 0 },
      { str: "Qty", x: 120, y: 700, width: 20, page: 0 },
      { str: "Amount", x: 200, y: 700, width: 40, page: 0 },
      { str: "Chicken", x: 10, y: 686, width: 35, page: 0 },
      { str: "shawarma", x: 46, y: 686, width: 45, page: 0 },
      { str: "2", x: 125, y: 686, width: 5, page: 0 },
      { str: "1,250.00", x: 196, y: 686.5, width: 44, page: 0 },
    ])!;
    expect(t.headers).toEqual(["Item", "Qty", "Amount"]);
    expect(t.rows).toEqual([["Chicken shawarma", "2", "1,250.00"]]);
  });
});

describe("Google Sheets links", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abc";
  it("turns a shared or published sheet link into its CSV export, keeping the tab", () => {
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=123`,
    );
    expect(googleSheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`,
    );
    expect(googleSheetCsvUrl(` https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstu/pubhtml?gid=5 `)).toBe(
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstu/pub?output=csv&gid=5",
    );
  });

  it("refuses anything that isn't a Google Sheets link", () => {
    for (const bad of [
      `http://docs.google.com/spreadsheets/d/${id}/edit`,
      `https://docs.google.com.example.com/spreadsheets/d/${id}/edit`,
      `https://drive.google.com/file/d/${id}/view`,
      `https://docs.google.com/document/d/${id}/edit`,
      "not a link",
      "",
    ]) {
      expect(googleSheetCsvUrl(bad)).toBeNull();
    }
  });
});
