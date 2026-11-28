// Reading a menu costing workbook (lib/menu-workbook.ts): the same three-sheet
// layout as a restaurant's own costing sheet, with made-up dishes and the
// kinds of problems such sheets have.
import { describe, expect, it } from "vitest";
import { decimalToScaled, parsePricingUnit, planCosts, planToJson, readWorkbook } from "@/lib/menu-workbook";
import { SAMPLE_WORKBOOK } from "./workbook-fixture";

describe("cells and units", () => {
  it("reads decimals exactly, including scientific notation", () => {
    expect(decimalToScaled("26.67", 4)).toBe(266_700n);
    expect(decimalToScaled("1.0000000000000001E-3", 4)).toBe(10n);
    expect(decimalToScaled("21.599999999999998", 4)).toBe(216_000n);
    expect(decimalToScaled("", 4)).toBeNull();
    expect(decimalToScaled("abc", 4)).toBeNull();
  });

  it("understands kg, L, pieces and packs", () => {
    expect(parsePricingUnit("kg")).toMatchObject({ baseUnit: "g", perMilli: 1_000_000n });
    expect(parsePricingUnit("L")).toMatchObject({ baseUnit: "ml", perMilli: 1_000_000n, label: "L" });
    expect(parsePricingUnit("unit")).toMatchObject({ baseUnit: "unit", perMilli: 1000n });
    expect(parsePricingUnit("unit (30g)")).toMatchObject({ baseUnit: "g", perMilli: 30_000n, label: "unit (30 g)" });
    expect(parsePricingUnit("crate")).toBeNull();
  });
});

describe("reading the workbook", () => {
  const plan = readWorkbook(SAMPLE_WORKBOOK);
  const recipe = (name: string) => plan.recipes.find((r) => r.name === name)!;
  const messages = (subject: string) => plan.issues.filter((i) => i.subject.toLowerCase() === subject.toLowerCase()).map((i) => i.message);

  it("matches names ignoring case and stray spaces", () => {
    const toast = recipe("Cheese toast");
    expect(toast.lines.map((l) => l.ref)).toEqual([
      { type: "ingredient", key: "bread roll" },
      { type: "ingredient", key: "white cheese" },
      { type: "prep", key: "house dressing" },
      { type: "ingredient", key: "garden herb" },
      { type: "ingredient", key: "chives" },
    ]);
  });

  it("costs a sauce from its own recipe instead of its typed price, with an estimated batch size to confirm", () => {
    const dressing = recipe("House dressing");
    expect(dressing.kind).toBe("prep");
    expect(dressing).toMatchObject({ yieldMilli: "152000", yieldUnit: "g", yieldEstimated: true });
    expect(plan.ingredients.some((i) => i.key === "house dressing")).toBe(false);
    expect(messages("House dressing").join(" ")).toMatch(/costed from that recipe instead of the typed price/);
    expect(messages("House dressing").join(" ")).toMatch(/estimated at 152 g/);
  });

  it("keeps a raw ingredient that shares a dish's name as the ingredient, and the priced dish as a dish", () => {
    expect(recipe("Grilled potato").kind).toBe("dish");
    expect(recipe("Potato bowl").lines[0].ref).toEqual({ type: "ingredient", key: "grilled potato" });
    expect(recipe("Grilled potato").targetBp).toBe(2500); // differs from the business's 30%
  });

  it("lists every problem instead of costing it as zero", () => {
    expect(messages("flour")).toContain("No price. Dishes using it can't be fully costed until it has one.");
    expect(messages("chives")).toEqual(["Not in the price list; added without a price (used in Cheese toast)."]);
    expect(messages("Potato bowl")).toContain("Line with no ingredient; skipped.");
    expect(messages("lemon")).toContain("Ingredient line with no dish name; skipped.");
    expect(messages("Cake")).toContain('flour: unit "cups" isn\'t g, kg, ml, L or unit; line skipped.');
    expect(messages("Cake")).toContain("No selling price yet, so no food cost %.");
  });

  it("reads prices, packaging items and the business's target and overhead", () => {
    expect(plan.settings).toEqual({ targetBp: 3000, overheadBp: 2200 });
    expect(recipe("Cheese toast").sellingPriceE4).toBe("80000");
    const box = plan.ingredients.find((i) => i.name === "Box")!;
    expect(box).toMatchObject({ category: "Packaging", baseUnit: "unit" });
    expect(plan.ingredients.find((i) => i.name === "Bag small")!.price!.priceE4).toBe(2553n);
    expect(plan.ingredients.find((i) => i.key === "garden herb")!.price).toMatchObject({ perMilli: 30_000n, packLabel: "unit (30 g)" });
    expect(plan.ingredients.find((i) => i.key === "white cheese")!.supplier).toBe("Dairy Co");
  });

  it("costs the whole plan before anything is saved, and survives being stored as JSON", () => {
    const costs = planCosts(planToJson(plan));
    const toast = costs.get("r:cheese toast")!;
    expect(toast.complete).toBe(false); // chives has no price
    expect(toast.problems).toEqual(["chives has no price"]);
    // 1 roll $0.41 + 20 g cheese $0.5334 + 20 g of a 152 g dressing batch + 3 g of a 30 g herb bunch $0.04
    const dressing = costs.get("r:house dressing")!.costMicros; // 100 ml oil $0.89 + 50 g lemon $0.075 + 2 g salt $0.001
    expect(dressing).toBe(966_000n);
    expect(toast.costMicros).toBe(410_000n + 533_400n + 127_105n + 40_000n);
    expect(costs.get("r:grilled potato")!.complete).toBe(true);
  });

  it("refuses a workbook without the expected sheets", () => {
    expect(() => readWorkbook([{ name: "Sheet1", rows: [["a"]] }])).toThrow(/menu costing workbook/);
  });
});

describe("what the real sheets need", () => {
  it("takes a blank unit as pieces for something priced per piece (as the sheet's formula does), and says so", () => {
    const sheets = SAMPLE_WORKBOOK.map((s) => (s.name === "Recipes" ? { ...s, rows: [...s.rows, ["Egg plate", "bread roll", "2", ""]] } : s));
    const plan = readWorkbook(sheets);
    expect(plan.recipes.find((r) => r.name === "Egg plate")!.lines[0]).toMatchObject({ unit: "unit", quantityMilli: "2000" });
    expect(plan.issues.some((i) => i.subject === "Egg plate" && /taken as pieces/.test(i.message))).toBe(true);
  });

  it("points out a recipe whose name is a near-miss of a price-list item", () => {
    const sheets = SAMPLE_WORKBOOK.map((s) => (s.name === "Recipes" ? { ...s, rows: [...s.rows, ["lemmon", "lemon", "10", "g"]] } : s));
    const plan = readWorkbook(sheets);
    expect(plan.issues.filter((i) => i.subject === "lemmon").map((i) => i.message).join(" ")).toMatch(/Looks like "lemon"/);
  });
});
