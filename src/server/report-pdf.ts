// Monthly management package as a PDF (A4). Uses PDFKit's built-in Helvetica,
// so no font files to ship; text is kept to characters that font can draw.
import PDFDocument from "pdfkit";
import { formatAmount, formatRate, type Currency } from "@/lib/money";
import type { getComparison, PeriodReport } from "./reports";

type Doc = InstanceType<typeof PDFDocument>;
type Comparison = Awaited<ReturnType<typeof getComparison>>;

const INK = "#1c1917";
const MUTED = "#78716c";
const LINE = "#e7e5e4";
const HEADER_BG = "#f5f5f4";
const BRAND = "#065f46";
const RED = "#b91c1c";
const AMBER = "#b45309";
const M = 40; // page margin
const W = 595.28 - 2 * M; // A4 content width

const REASONS: Record<string, string> = {
  counting_error: "Counting error",
  unrecorded_expense: "Unrecorded expense",
  change_shortage: "Change given wrongly",
  rate_rounding: "Exchange-rate rounding",
  suspected_loss: "Suspected loss",
  other: "Other",
};
const PAID_FROM: Record<string, string> = {
  drawer: "Cash drawer",
  petty_cash: "Petty cash",
  bank: "Bank / transfer",
  owner: "Owner paid",
};

/** Helvetica in PDFs can't draw U+2212 or ≈, so swap them for plain equivalents. */
const pdfText = (s: string) => s.replace(/−/g, "-").replace(/≈/g, "~");
const money = (minor: bigint, c: Currency, signed = false) => pdfText(formatAmount(minor, c, { signed }));
const usd = (cents: bigint, signed = false) => money(cents, "USD", signed);
const varTone = (v: bigint) => (v < 0n ? RED : v > 0n ? AMBER : BRAND);

function dateLabel(iso: string, withYear = true) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

function pct(cur: bigint, prev: bigint) {
  if (prev === 0n) return "";
  const p = (Number(cur - prev) / Math.abs(Number(prev))) * 100;
  return ` (${p >= 0 ? "+" : ""}${p.toFixed(0)}%)`;
}

function fit(doc: Doc, s: string, width: number) {
  if (doc.widthOfString(s) <= width) return s;
  let t = s;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
  return `${t}…`;
}

function pageBottom(doc: Doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc: Doc, h: number) {
  if (doc.y + h > pageBottom(doc)) doc.addPage();
}

function section(doc: Doc, title: string, subtitle?: string) {
  ensureSpace(doc, 70);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(BRAND).text(title, M, doc.y, { width: W });
  if (subtitle) doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(pdfText(subtitle), M, doc.y + 1, { width: W });
  doc.moveDown(0.4);
}

type Col = { header: string; width: number; align?: "left" | "right" };
type Row = { cells: string[]; bold?: boolean; tones?: (string | undefined)[] };

function table(doc: Doc, cols: Col[], rows: Row[], fontSize = 8) {
  const rowH = fontSize + 7;
  const total = cols.reduce((s, c) => s + c.width, 0);
  const header = () => {
    const y = doc.y;
    doc.rect(M, y, total, rowH).fill(HEADER_BG);
    doc.font("Helvetica-Bold").fontSize(fontSize - 1).fillColor(MUTED);
    let x = M;
    for (const c of cols) {
      doc.text(fit(doc, c.header.toUpperCase(), c.width - 8), x + 4, y + 4.5, {
        width: c.width - 8,
        align: c.align ?? "left",
        lineBreak: false,
      });
      x += c.width;
    }
    doc.y = y + rowH;
  };
  ensureSpace(doc, rowH * 3);
  header();
  for (const row of rows) {
    if (doc.y + rowH > pageBottom(doc)) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (row.bold) doc.moveTo(M, y).lineTo(M + total, y).lineWidth(0.8).strokeColor(MUTED).stroke();
    doc.font(row.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    let x = M;
    cols.forEach((c, i) => {
      doc.fillColor(row.tones?.[i] ?? INK).text(fit(doc, pdfText(row.cells[i] ?? ""), c.width - 8), x + 4, y + 4, {
        width: c.width - 8,
        align: c.align ?? "left",
        lineBreak: false,
      });
      x += c.width;
    });
    doc.moveTo(M, y + rowH).lineTo(M + total, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
    doc.y = y + rowH;
  }
  doc.x = M;
  doc.moveDown(0.6);
}

function keyFigures(doc: Doc, items: { label: string; value: string; tone?: string; sub?: string }[]) {
  const gap = 8;
  const w = (W - gap * (items.length - 1)) / items.length;
  const h = 52;
  ensureSpace(doc, h + 10);
  const y = doc.y;
  items.forEach((it, i) => {
    const x = M + i * (w + gap);
    doc.roundedRect(x, y, w, h, 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor(MUTED).text(it.label.toUpperCase(), x + 8, y + 8, { width: w - 16, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(it.tone ?? INK).text(pdfText(it.value), x + 8, y + 19, { width: w - 16, lineBreak: false });
    if (it.sub) doc.font("Helvetica").fontSize(6.5).fillColor(MUTED).text(fit(doc, pdfText(it.sub), w - 16), x + 8, y + 38, { width: w - 16, lineBreak: false });
  });
  doc.y = y + h + 8;
  doc.x = M;
}

export async function renderReportPdf(
  r: PeriodReport,
  opts: { comparison?: Comparison | null; generatedBy: string; generatedAt?: Date },
): Promise<Buffer> {
  const period = `${dateLabel(r.filter.from)} - ${dateLabel(r.filter.to)}`;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: M, bottom: 50, left: M, right: M },
    bufferPages: true,
    info: { Title: `${r.org.name} management report ${r.filter.from} to ${r.filter.to}`, Author: "Cash Control" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const t = r.totals;
  // Only compare when the previous period actually had business days.
  const cmp = opts.comparison && opts.comparison.days > 0 ? opts.comparison : null;
  const generatedAt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Beirut",
  }).format(opts.generatedAt ?? new Date());

  // ---------------------------------------------------------------- header
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(r.org.name, M, M, { width: W });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`Management report  |  ${period}`, { width: W });
  const scope = r.location ? r.location.name : `All locations (${r.locations.map((l) => l.name).join(", ")})`;
  const rateText =
    r.rates.min == null
      ? "No business days in this period"
      : r.rates.min === r.rates.max
        ? `${formatRate(r.rates.min)} LBP/$`
        : `${formatRate(r.rates.min)} to ${formatRate(r.rates.max!)} LBP/$ (${r.rates.count} rates)`;
  doc
    .fontSize(8)
    .text(`${scope}  |  Exchange rate: ${rateText}  |  Generated ${generatedAt} (Beirut) by ${opts.generatedBy}`, { width: W });
  doc.moveDown(0.8);

  // ---------------------------------------------------------------- key figures
  keyFigures(doc, [
    {
      label: "Collected",
      value: usd(t.salesEq.collected),
      sub: cmp ? `Previous: ${usd(cmp.collectedEq)}${pct(t.salesEq.collected, cmp.collectedEq)}` : undefined,
    },
    {
      label: "Recorded expenses",
      value: usd(t.expensesEq),
      sub: cmp ? `Previous: ${usd(cmp.expensesEq)}${pct(t.expensesEq, cmp.expensesEq)}` : undefined,
    },
    {
      label: "Collected - expenses",
      value: usd(t.cashResultEq),
      sub: cmp ? `Previous: ${usd(cmp.cashResultEq)}` : undefined,
    },
    {
      label: "Cash difference",
      value: usd(r.cash.netAfterAdjustmentsEq, true),
      tone: varTone(r.cash.netAfterAdjustmentsEq),
      sub: `${r.cash.flaggedDays} flagged of ${r.cash.closedDays} closed days`,
    },
  ]);

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(INK)
    .text("Net profit: ", M, doc.y, { continued: true })
    .font("Helvetica")
    .fillColor(MUTED)
    .text(`${r.netProfit.reason} "Collected - expenses" is a cash view; it includes VAT collected and is not profit.`, {
      width: W,
    });
  if (r.cash.openDays.length) {
    doc.moveDown(0.4);
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(RED)
      .text(
        `${r.cash.openDays.length} day${r.cash.openDays.length === 1 ? " is" : "s are"} still open, so figures for ${
          r.cash.openDays.length === 1 ? "it" : "them"
        } are not final: ${r.cash.openDays.map((d) => `${d.locationName} ${dateLabel(d.date, false)}`).join(", ")}.`,
        M,
        doc.y,
        { width: W },
      );
  }

  // ---------------------------------------------------------------- sales
  section(doc, "Sales", "From the POS end-of-day totals. USD-equivalents use each day's own rate.");
  const s = t.sales;
  const se = t.salesEq;
  const salesRow = (label: string, p: { USD: bigint; LBP: bigint }, eq: bigint, bold = false): Row => ({
    cells: [label, money(p.USD, "USD"), money(p.LBP, "LBP"), usd(eq)],
    bold,
  });
  table(
    doc,
    [
      { header: "Line", width: 215 },
      { header: "USD", width: 100, align: "right" },
      { header: "LBP", width: 100, align: "right" },
      { header: "~ USD", width: 100, align: "right" },
    ],
    [
      salesRow("Cash payments", s.byTender.cash, se.cash),
      salesRow("Card payments", s.byTender.card, se.card),
      salesRow("Other payments", s.byTender.other, se.other),
      salesRow("Less refunds", { USD: -s.refunds.USD, LBP: -s.refunds.LBP }, -se.refunds),
      salesRow("Collected", s.collected, se.collected, true),
      salesRow("Discounts given (memo)", s.discounts, se.discounts),
      salesRow("Voids (memo)", s.voids, se.voids),
      salesRow("VAT included (memo)", s.tax, se.tax),
      salesRow("Service charge (memo)", s.serviceCharge, se.serviceCharge),
    ],
  );

  // ---------------------------------------------------------------- expenses
  section(
    doc,
    "Expenses by category",
    `Active expenses only${t.voidedExpenses ? `; ${t.voidedExpenses} voided expense(s) excluded` : ""}. Converted at the rate stored with each expense.`,
  );
  table(
    doc,
    [
      { header: "Category", width: 175 },
      { header: "Items", width: 40, align: "right" },
      { header: "USD", width: 80, align: "right" },
      { header: "LBP", width: 95, align: "right" },
      { header: "~ USD", width: 80, align: "right" },
      { header: "Share", width: 45, align: "right" },
    ],
    [
      ...r.categories.map((c) => ({
        cells: [
          c.name,
          String(c.count),
          money(c.pair.USD, "USD"),
          money(c.pair.LBP, "LBP"),
          usd(c.eq),
          t.expensesEq > 0n ? `${((Number(c.eq) / Number(t.expensesEq)) * 100).toFixed(0)}%` : "",
        ],
      })),
      {
        cells: [
          "Total",
          String(r.categories.reduce((n, c) => n + c.count, 0)),
          money(t.expenses.USD, "USD"),
          money(t.expenses.LBP, "LBP"),
          usd(t.expensesEq),
          "",
        ],
        bold: true,
      },
    ],
  );
  if (r.paidFrom.length) {
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(`Paid from: ${r.paidFrom.map((p) => `${PAID_FROM[p.paidFrom]} ${usd(p.eq)}`).join("   |   ")}`, M, doc.y, { width: W });
  }

  // ---------------------------------------------------------------- cash control
  section(
    doc,
    "Cash control",
    `Expected vs counted cash at closing. A day is flagged when the difference is more than ${usd(r.org.toleranceCents)}.`,
  );
  const c = r.cash;
  table(
    doc,
    [
      { header: "Measure", width: 315 },
      { header: "Value", width: 200, align: "right" },
    ],
    [
      { cells: ["Business days in period", String(c.days)] },
      { cells: ["Closed and locked", String(c.closedDays)] },
      { cells: ["Balanced (within tolerance)", String(c.balancedDays)] },
      { cells: ["Flagged", String(c.flaggedDays)], tones: [undefined, c.flaggedDays ? RED : undefined] },
      { cells: ["Total shortages", usd(c.shortEq, true)], tones: [undefined, varTone(c.shortEq)] },
      { cells: ["Total overages", usd(c.overEq, true)], tones: [undefined, varTone(c.overEq)] },
      { cells: ["Net difference at closing", usd(c.netVarianceEq, true)], tones: [undefined, varTone(c.netVarianceEq)] },
      { cells: ["Corrections posted after closing", usd(c.adjustmentsEq, true)] },
      {
        cells: ["Net difference after corrections", usd(c.netAfterAdjustmentsEq, true)],
        bold: true,
        tones: [undefined, varTone(c.netAfterAdjustmentsEq)],
      },
    ],
  );
  if (c.reasons.length) {
    table(
      doc,
      [
        { header: "Reason given", width: 315 },
        { header: "Days", width: 80, align: "right" },
        { header: "Difference", width: 120, align: "right" },
      ],
      c.reasons.map((x) => ({
        cells: [REASONS[x.reason] ?? x.reason, String(x.count), usd(x.eq, true)],
        tones: [undefined, undefined, varTone(x.eq)],
      })),
    );
  }
  const notes = r.daily.filter((d) => d.closing?.note && !d.closing.withinTolerance);
  if (notes.length) {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK).text("Notes on flagged days", M, doc.y, { width: W });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    for (const d of notes) {
      ensureSpace(doc, 14);
      doc.text(`${dateLabel(d.date, false)} ${d.locationName}: "${d.closing!.note}"`, M, doc.y + 1, { width: W });
    }
  }

  // ---------------------------------------------------------------- by location
  if (r.byLocation.length > 1) {
    section(doc, "By location");
    table(
      doc,
      [
        { header: "Location", width: 135 },
        { header: "Days", width: 50, align: "right" },
        { header: "Flagged", width: 50, align: "right" },
        { header: "Collected", width: 70, align: "right" },
        { header: "Expenses", width: 70, align: "right" },
        { header: "Coll. - exp.", width: 70, align: "right" },
        { header: "Cash diff.", width: 70, align: "right" },
      ],
      r.byLocation.map((l) => ({
        cells: [
          l.name,
          `${l.closedDays}/${l.days}`,
          String(l.flaggedDays),
          usd(l.collectedEq),
          usd(l.expensesEq),
          usd(l.cashResultEq),
          usd(l.varianceAfterEq, true),
        ],
        tones: [undefined, undefined, l.flaggedDays ? RED : undefined, undefined, undefined, undefined, varTone(l.varianceAfterEq)],
      })),
    );
  }

  // ---------------------------------------------------------------- daily detail
  section(doc, "Daily detail", "One line per business day. ~USD at that day's rate. Difference shown after any corrections.");
  table(
    doc,
    [
      { header: "Date", width: 50 },
      { header: "Location", width: 62 },
      { header: "Rate", width: 40, align: "right" },
      { header: "Collected", width: 58, align: "right" },
      { header: "Cash USD", width: 52, align: "right" },
      { header: "Cash LBP", width: 66, align: "right" },
      { header: "Expenses", width: 52, align: "right" },
      { header: "Difference", width: 52, align: "right" },
      { header: "Status", width: 83 },
    ],
    r.daily.map((d) => {
      const status = !d.closing
        ? "Open"
        : d.closing.withinTolerance
          ? "Balanced"
          : REASONS[d.closing.reason ?? "other"] ?? "Flagged";
      return {
        cells: [
          dateLabel(d.date, false),
          d.locationName,
          formatRate(d.rate),
          usd(d.salesEq.collected),
          money(d.sales.byTender.cash.USD, "USD"),
          money(d.sales.byTender.cash.LBP, "LBP").replace("LBP ", ""),
          usd(d.expensesEq),
          d.varianceAfterEq == null ? "-" : usd(d.varianceAfterEq, true),
          status,
        ],
        tones: [
          undefined,
          undefined,
          MUTED,
          undefined,
          undefined,
          undefined,
          undefined,
          d.varianceAfterEq == null ? MUTED : varTone(d.varianceAfterEq),
          !d.closing ? AMBER : d.closing.withinTolerance ? undefined : RED,
        ],
      };
    }),
    7.5,
  );

  // ---------------------------------------------------------------- footers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 32;
    doc.moveTo(M, y - 6).lineTo(M + W, y - 6).lineWidth(0.4).strokeColor(LINE).stroke();
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(MUTED)
      .text(`${r.org.name}  |  Management report  |  ${period}`, M, y, { width: W - 80, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M + W - 80, y, { width: 80, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
