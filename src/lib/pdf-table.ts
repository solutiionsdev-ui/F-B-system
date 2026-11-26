// Rebuilds a table from the text of a PDF export (a POS "sales lines" report
// printed or saved as PDF). The PDF only says where each piece of text sits,
// so lines are grouped by height and cells by the header's columns. The table
// that comes out goes through the same column matching as a CSV or Excel
// file: nothing is guessed about what the columns mean.

export type PdfItem = {
  str: string;
  /** Left edge, in PDF units (origin bottom-left). */
  x: number;
  /** Baseline height, in PDF units; larger is higher on the page. */
  y: number;
  width: number;
  page: number;
};

type Cell = { text: string; x: number; end: number };

/** Text that reads as an amount, a count or a percentage, not a column name. */
const NUMBERISH = /^[-+(]?\s*[$€£]?\s*[\d][\d.,\s]*%?\)?$/;
const DATEISH = /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|\d{1,2}:\d{2}/;
const LETTER = /[A-Za-z؀-ۿ]/;

/** Same page and roughly the same baseline. */
const LINE_TOLERANCE = 3;
/** Pieces of text closer than this are one cell (PDFs often split words). */
const CELL_GAP = 3;

function linesOf(items: PdfItem[]): Cell[][] {
  const sorted = items
    .filter((i) => i.str.trim() !== "")
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= LINE_TOLERANCE) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  return lines.map((l) => {
    const cells: Cell[] = [];
    for (const it of [...l.items].sort((a, b) => a.x - b.x)) {
      const prev = cells.at(-1);
      const gap = prev ? it.x - prev.end : Infinity;
      if (prev && gap < CELL_GAP) {
        prev.text += gap > 0.5 && !prev.text.endsWith(" ") && !it.str.startsWith(" ") ? ` ${it.str}` : it.str;
        prev.end = Math.max(prev.end, it.x + it.width);
      } else {
        cells.push({ text: it.str, x: it.x, end: it.x + it.width });
      }
    }
    return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text !== "");
  });
}

function looksLikeHeader(cells: Cell[]) {
  return (
    cells.length >= 3 &&
    cells.every((c) => LETTER.test(c.text) && !NUMBERISH.test(c.text) && !DATEISH.test(c.text) && c.text.length <= 40)
  );
}

/**
 * The table in a PDF's text, or null when there isn't one (a Z-report
 * summary, a letter, a scan with no text). The first line that reads like
 * column names is the header; a header repeated on later pages is skipped;
 * lines filling fewer than half the columns (titles, page numbers, totals)
 * are left out.
 */
export function tableFromPdfItems(items: PdfItem[]): { headers: string[]; rows: string[][]; ignoredLines: number } | null {
  const lines = linesOf(items);
  const minCells = (n: number) => Math.max(2, Math.ceil(n / 2));
  const at = lines.findIndex(
    (cells, i) => looksLikeHeader(cells) && lines.slice(i + 1, i + 4).filter((l) => l.length >= minCells(cells.length)).length >= 1,
  );
  if (at < 0) return null;
  const head = lines[at];
  const headers = head.map((c) => c.text);
  const centers = head.map((c) => (c.x + c.end) / 2);
  // Each column runs halfway to its neighbours' centres.
  const bounds = centers.map((c, i) => [i === 0 ? -Infinity : (centers[i - 1] + c) / 2, i === centers.length - 1 ? Infinity : (c + centers[i + 1]) / 2]);
  const columnOf = (cell: Cell) => {
    let best = 0;
    let bestOverlap = -Infinity;
    const mid = (cell.x + cell.end) / 2;
    bounds.forEach(([lo, hi], i) => {
      const overlap = Math.min(cell.end, hi) - Math.max(cell.x, lo);
      const score = overlap > 0 ? overlap : -Math.min(Math.abs(mid - lo), Math.abs(mid - hi));
      if (score > bestOverlap) {
        bestOverlap = score;
        best = i;
      }
    });
    return best;
  };
  const same = (cells: Cell[]) => cells.length === head.length && cells.every((c, i) => c.text === headers[i]);

  const rows: string[][] = [];
  let ignoredLines = 0;
  for (const cells of lines.slice(at + 1)) {
    if (same(cells)) continue;
    const row = headers.map(() => "");
    for (const c of cells) {
      const i = columnOf(c);
      row[i] = row[i] ? `${row[i]} ${c.text}` : c.text;
    }
    if (row.filter((v) => v !== "").length >= minCells(headers.length)) rows.push(row);
    else ignoredLines++;
  }
  return rows.length ? { headers, rows, ignoredLines } : null;
}

/**
 * The CSV export address for a Google Sheets link, or null when it isn't one.
 * Works for a sheet shared as "anyone with the link can view" and for a sheet
 * published to the web. The tab in the link (gid) is kept.
 */
export function googleSheetCsvUrl(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const gid = u.searchParams.get("gid") ?? new URLSearchParams(u.hash.replace(/^#/, "")).get("gid") ?? "0";
  if (!/^\d+$/.test(gid)) return null;
  const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})\//);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv&gid=${gid}`;
  const shared = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/);
  if (shared) return `https://docs.google.com/spreadsheets/d/${shared[1]}/export?format=csv&gid=${gid}`;
  return null;
}
