import type { NextRequest } from "next/server";
import { getContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { UserError } from "@/server/operations";
import { dailyCsv, expensesCsv, reportFileName } from "@/server/report-csv";
import { renderReportPdf } from "@/server/report-pdf";
import { getComparison, getPeriodReport } from "@/server/reports";

/** Downloads: ?format=pdf, or ?format=csv&kind=daily|expenses, plus from/to/location. */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const format = sp.get("format");
  const kind = sp.get("kind") === "expenses" ? "expenses" : "daily";
  const filter = { from: sp.get("from") ?? "", to: sp.get("to") ?? "", locationId: sp.get("location") || null };

  try {
    const db = await getDb();
    const report = await getPeriodReport(db, ctx.scope, filter);
    const headers = (type: string, name: string) => ({
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (format === "pdf") {
      const comparison = await getComparison(db, ctx.scope, filter);
      const pdf = await renderReportPdf(report, { comparison, generatedBy: ctx.user.name });
      return new Response(new Uint8Array(pdf), {
        headers: headers("application/pdf", reportFileName(report, "management-report", "pdf")),
      });
    }
    if (format === "csv") {
      const body = kind === "expenses" ? expensesCsv(report) : dailyCsv(report);
      return new Response(body, { headers: headers("text/csv; charset=utf-8", reportFileName(report, kind, "csv")) });
    }
    return new Response("Unknown format.", { status: 400 });
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
