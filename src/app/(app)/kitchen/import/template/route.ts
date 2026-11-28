import type { NextRequest } from "next/server";
import { PRICES_TEMPLATE_FILE, pricesTemplate, RECIPE_TEMPLATE_FILE, recipeTemplate } from "@/lib/recipe-template";
import { writeXlsx } from "@/lib/xlsx-writer";
import { getContext } from "@/server/auth";

/** Downloads the Excel template for importing prices and recipes, or prices only with ?kind=prices (example rows only, no business data). */
export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  const prices = req.nextUrl.searchParams.get("kind") === "prices";
  const bytes = writeXlsx(prices ? pricesTemplate() : recipeTemplate());
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${prices ? PRICES_TEMPLATE_FILE : RECIPE_TEMPLATE_FILE}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
