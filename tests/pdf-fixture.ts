// Test PDFs, printed with pdfkit the way a POS prints a report: a title, a
// table with the header repeated on each page, amounts right-aligned, a page
// number and a total line under the table.
import PDFDocument from "pdfkit";
import { OMEGA_SAMPLE_HEADERS, omegaSampleRows } from "@/lib/omega-sample";

export function renderPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve) => doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks)))));
  draw(doc);
  doc.end();
  return done;
}

/** Column left edges and widths for the seven Omega columns; the last (Amount) is right-aligned. */
const COLS = [
  { x: 36, w: 90 },
  { x: 132, w: 30 },
  { x: 170, w: 100 },
  { x: 278, w: 60 },
  { x: 346, w: 80 },
  { x: 432, w: 50 },
  { x: 490, w: 70, right: true },
];

export function omegaSamplePdf(date: string, rowsPerPage = 30): Promise<Uint8Array> {
  const rows = omegaSampleRows(date);
  return renderPdf((doc) => {
    const header = (y: number) => {
      doc.font("Helvetica-Bold").fontSize(9);
      OMEGA_SAMPLE_HEADERS.forEach((h, i) => doc.text(h, COLS[i].x, y, { width: COLS[i].w, align: COLS[i].right ? "right" : "left", lineBreak: false }));
      doc.font("Helvetica");
    };
    const pages = Math.ceil(rows.length / rowsPerPage);
    for (let p = 0; p < pages; p++) {
      if (p > 0) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(13).text("Omega POS - Daily Sales & Payment Export", 36, 40, { lineBreak: false });
      doc.font("Helvetica").fontSize(9).text(`Branch: Demo · Business date ${date}`, 36, 60, { lineBreak: false });
      header(90);
      let y = 108;
      for (const r of rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage)) {
        r.forEach((v, i) => doc.text(v, COLS[i].x, y, { width: COLS[i].w, align: COLS[i].right ? "right" : "left", lineBreak: false }));
        y += 14;
      }
      if (p === pages - 1) doc.font("Helvetica-Bold").text("Total", 36, y + 8, { lineBreak: false }).text("1,234.56", 490, y + 8, { width: 70, align: "right", lineBreak: false });
      doc.font("Helvetica").fontSize(8).text(`Page ${p + 1} of ${pages}`, 36, 800, { lineBreak: false });
    }
  });
}
