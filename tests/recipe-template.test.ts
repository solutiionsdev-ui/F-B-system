// The Excel template for importing prices and recipes: it opens as a real
// .xlsx, its example rows are skipped, and once filled in (here: the example
// names with "Example – " removed) every dish is fully costed on the first
// import, with exact batch sizes, usable % and weights.
import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { planCosts, readWorkbook, type Sheet } from "@/lib/menu-workbook";
import { recipeTemplate, TEMPLATE_HEADERS } from "@/lib/recipe-template";
import { writeXlsx } from "@/lib/xlsx-writer";
import { filledTemplate } from "./workbook-fixture";

async function readBack(bytes: Uint8Array): Promise<Sheet[]> {
  const sheets = await readXlsxFile(Buffer.from(bytes), { parseNumber: (s: string) => s });
  return sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map((c) => (c == null ? "" : String(c)))) }));
}

describe("the recipe import template", () => {
  it("is a real workbook with the sheets and columns the importer reads", async () => {
    const sheets = await readBack(writeXlsx(recipeTemplate()));
    expect(sheets.map((s) => s.name)).toEqual(["How to fill", "PriceList", "Recipes", "MenuCosts"]);
    expect(sheets[1].rows[0]).toEqual(TEMPLATE_HEADERS.prices);
    expect(sheets[2].rows[0]).toEqual(TEMPLATE_HEADERS.recipes);
    expect(sheets[3].rows[0]).toEqual(TEMPLATE_HEADERS.menu);
    expect(sheets[1].rows[1][2]).toBe("12.5"); // numbers stay numbers
  });

  it("skips its own example rows, so importing it untouched adds nothing", async () => {
    const plan = readWorkbook(await readBack(writeXlsx(recipeTemplate())));
    expect(plan.ingredients).toHaveLength(0);
    expect(plan.recipes).toHaveLength(0);
    expect(plan.issues.find((i) => i.subject === "Examples")!.message).toBe('18 example rows (names starting with "Example") skipped.');
  });

  it("imports a filled-in template fully costed, with exact batch sizes, usable % and weights", async () => {
    const plan = readWorkbook(await readBack(writeXlsx(filledTemplate())));
    expect(plan.settings).toEqual({ targetBp: 3000, overheadBp: 2200 }); // "30" and "22" read as percentages
    const sauce = plan.recipes.find((r) => r.name === "Garlic sauce")!;
    expect(sauce).toMatchObject({ kind: "prep", yieldMilli: "400000", yieldUnit: "g", yieldEstimated: false });
    const toast = plan.recipes.find((r) => r.name === "Halloumi toast")!;
    expect(toast).toMatchObject({ kind: "dish", sellingPriceE4: "90000", packagingE4: "6000" });
    const ing = (name: string) => plan.ingredients.find((i) => i.name === name)!;
    expect(ing("Tomato").yieldBp).toBe(9000);
    expect(ing("Olive oil").gramsPerMlE4).toBe("9100");
    expect(ing("Egg").gramsPerUnitMilli).toBe("60000");
    expect(ing("Basil").price).toMatchObject({ perMilli: 30_000n });
    expect(plan.issues.filter((i) => i.level !== "info")).toEqual([]); // nothing to fix or check

    const costs = planCosts(plan);
    expect(costs.get("r:halloumi toast")).toMatchObject({ complete: true, warnings: [] });
    // Sauce batch: 80 g garlic at $4/kg, 85% usable ($0.376471) + 300 ml oil at $8.90/L ($2.67) + 60 g lemon at $1.50/kg, 45% usable ($0.2)
    expect(costs.get("r:garlic sauce")!.costMicros).toBe(376_471n + 2_670_000n + 200_000n);
  });
});
