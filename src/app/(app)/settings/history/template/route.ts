import { HISTORY_TEMPLATE_FILE, historyTemplate } from "@/lib/history-template";
import { writeXlsx } from "@/lib/xlsx-writer";
import { getContext } from "@/server/auth";

/** Downloads the Excel template for importing past business days (example rows only, no business data). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  return new Response(Buffer.from(writeXlsx(historyTemplate())), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${HISTORY_TEMPLATE_FILE}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
