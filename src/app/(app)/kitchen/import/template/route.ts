import { RECIPE_TEMPLATE_FILE, recipeTemplate } from "@/lib/recipe-template";
import { writeXlsx } from "@/lib/xlsx-writer";
import { getContext } from "@/server/auth";

/** Downloads the Excel template for importing prices and recipes (example rows only, no business data). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  const bytes = writeXlsx(recipeTemplate());
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${RECIPE_TEMPLATE_FILE}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
