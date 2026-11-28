// The recipe costing engine (lib/costing.ts): exact unit conversion, usable
// yield, preps costed from their own batch, problems instead of zeros, and
// food cost against the target. Made-up dishes and prices.
import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  costRecipes,
  foodCost,
  formatBp,
  formatMicros,
  type CostIngredient,
  type CostLine,
  type CostRecipe,
} from "@/lib/costing";
import { parseRate } from "@/lib/money";

const usd = (dollars: string) => BigInt(Math.round(Number(dollars) * 10000)); // test helper only: to e4
const KG = 1_000_000n;

function ing(id: string, p: Partial<CostIngredient> = {}): CostIngredient {
  return { id, name: id, baseUnit: "g", gramsPerMlE4: null, gramsPerUnitMilli: null, yieldBp: 10000, price: null, ...p };
}
const line = (ref: { ingredientId?: string; subRecipeId?: string }, qty: number, unit: CostLine["unit"]): CostLine => ({
  ingredientId: ref.ingredientId ?? null,
  subRecipeId: ref.subRecipeId ?? null,
  quantityMilli: BigInt(qty * 1000),
  unit,
});
function recipe(id: string, lines: CostLine[], extra: Partial<CostRecipe> = {}): CostRecipe {
  return { id, name: id, kind: "dish", yieldMilli: null, yieldUnit: null, yieldEstimated: false, lines, ...extra };
}
function run(ings: CostIngredient[], recs: CostRecipe[], rate: bigint | null = null) {
  return costRecipes(new Map(ings.map((i) => [i.id, i])), new Map(recs.map((r) => [r.id, r])), rate);
}

const cheese = ing("cheese", { price: { currency: "USD", priceE4: usd("26.67"), perMilli: KG, packLabel: "kg" } });
const bread = ing("bread", { baseUnit: "unit", price: { currency: "USD", priceE4: usd("0.41"), perMilli: 1000n, packLabel: "unit" } });
const oil = ing("oil", { baseUnit: "ml", gramsPerMlE4: 9100n, price: { currency: "USD", priceE4: usd("8.90"), perMilli: KG, packLabel: "L" } });
const herb = ing("herb", { price: { currency: "USD", priceE4: usd("0.40"), perMilli: 30_000n, packLabel: "bunch (30 g)" } });

describe("unit conversion", () => {
  it("converts kg, litres, density and pieces exactly", () => {
    expect(convertQuantity(1500n, "kg", "g", { gramsPerMlE4: null, gramsPerUnitMilli: null }, "x")).toEqual({ num: 1_500_000n, den: 1n });
    // 20 g of oil at 0.91 g/ml is 21.978… ml: kept as an exact fraction
    const q = convertQuantity(20_000n, "g", "ml", { gramsPerMlE4: 9100n, gramsPerUnitMilli: null }, "oil");
    expect(q).toEqual({ num: 20_000n * 10_000n, den: 9100n });
    // 2 eggs of 60 g each = 120 g
    const eggs = convertQuantity(2000n, "unit", "g", { gramsPerMlE4: null, gramsPerUnitMilli: 60_000n }, "egg");
    expect(eggs).toEqual({ num: 2000n * 60_000n, den: 1000n });
  });

  it("says why when it can't convert, instead of guessing", () => {
    expect(convertQuantity(20_000n, "g", "ml", { gramsPerMlE4: null, gramsPerUnitMilli: null }, "Thyme sauce")).toMatch(/weight per ml/);
    expect(convertQuantity(20_000n, "g", "unit", { gramsPerMlE4: null, gramsPerUnitMilli: null }, "Bread")).toMatch(/weight of one piece/);
  });
});

describe("recipe cost", () => {
  it("costs each line at its price, unit and yield, exactly", () => {
    const avocado = ing("avocado", { yieldBp: 7000, price: { currency: "USD", priceE4: usd("3.50"), perMilli: KG, packLabel: "kg" } });
    const costs = run(
      [cheese, bread, oil, herb, avocado],
      [recipe("toast", [line({ ingredientId: "bread" }, 1, "unit"), line({ ingredientId: "cheese" }, 20, "g"), line({ ingredientId: "oil" }, 10, "g"), line({ ingredientId: "herb" }, 3, "g"), line({ ingredientId: "avocado" }, 40, "g")])],
    );
    const t = costs.get("toast")!;
    expect(t.complete).toBe(true);
    expect(t.lines.map((l) => l.costMicros)).toEqual([
      410_000n, // $0.41
      533_400n, // 20 g of $26.67/kg
      97_802n, // 10 g of oil = 10.989 ml of $8.90/L
      40_000n, // 3 g of a $0.40 bunch of 30 g
      200_000n, // 40 g usable at 70% yield: 57.14 g bought at $3.50/kg
    ]);
    expect(t.costMicros).toBe(410_000n + 533_400n + 97_802n + 40_000n + 200_000n);
  });

  it("never costs a missing price or unit as zero: the dish is marked incomplete", () => {
    const flour = ing("flour"); // no price
    const sauce = ing("sauce", { baseUnit: "ml", price: { currency: "USD", priceE4: usd("3.10"), perMilli: KG, packLabel: "L" } });
    const t = run([cheese, flour, sauce], [recipe("pie", [line({ ingredientId: "cheese" }, 20, "g"), line({ ingredientId: "flour" }, 100, "g"), line({ ingredientId: "sauce" }, 20, "g")])]).get("pie")!;
    expect(t.complete).toBe(false);
    expect(t.costMicros).toBe(533_400n); // only what could be costed
    expect(t.problems).toEqual(["flour has no price", "sauce is measured by weight here but priced by volume; set its weight per ml"]);
    expect(t.lines.map((l) => l.costMicros)).toEqual([533_400n, null, null]);
  });

  it("converts LBP prices at the rate, and refuses without one", () => {
    const lemon = ing("lemon", { price: { currency: "LBP", priceE4: 1_345_500n * 10_000n, perMilli: KG, packLabel: "kg" } });
    const r = recipe("lemonade", [line({ ingredientId: "lemon" }, 100, "g")]);
    expect(run([lemon], [r], parseRate("89,700")).get("lemonade")!.costMicros).toBe(1_500_000n); // 134,550 LBP = $1.50
    expect(run([lemon], [r], null).get("lemonade")!.problems[0]).toMatch(/no exchange rate/);
  });
});

describe("preps (sauces and other sub-recipes)", () => {
  const sauce = recipe("pesto", [line({ ingredientId: "herb" }, 60, "g"), line({ ingredientId: "oil" }, 100, "ml"), line({ ingredientId: "cheese" }, 40, "g")], {
    kind: "prep",
    yieldMilli: 200_000n,
    yieldUnit: "g",
  });

  it("costs a portion from the batch: when an ingredient's price changes, every dish using the sauce follows", () => {
    const pasta = recipe("pasta", [line({ subRecipeId: "pesto" }, 20, "g")]);
    const before = run([cheese, oil, herb], [sauce, pasta]);
    const batch = before.get("pesto")!.costMicros; // 0.80 + 0.89 + 1.0668
    expect(batch).toBe(800_000n + 890_000n + 1_066_800n);
    expect(before.get("pasta")!.costMicros).toBe(275_680n); // 20 g of a 200 g batch
    const dearerCheese = { ...cheese, price: { ...cheese.price!, priceE4: usd("30.00") } };
    const after = run([dearerCheese, oil, herb], [sauce, pasta]);
    expect(after.get("pasta")!.costMicros).toBeGreaterThan(before.get("pasta")!.costMicros);
  });

  it("flags a prep with no batch size or an estimated one, and passes a prep's problems up", () => {
    const noYield = { ...sauce, yieldMilli: null, yieldUnit: null };
    const pasta = recipe("pasta", [line({ subRecipeId: "pesto" }, 20, "g")]);
    expect(run([cheese, oil, herb], [noYield, pasta]).get("pasta")!.problems).toEqual(["pesto has no batch size, so a portion of it can't be costed"]);
    const estimated = { ...sauce, yieldEstimated: true };
    expect(run([cheese, oil, herb], [estimated, pasta]).get("pasta")!.warnings).toEqual(["pesto's batch size is an estimate; confirm it"]);
    const missing = run([oil, herb, ing("cheese")], [sauce, pasta]).get("pasta")!;
    expect(missing.complete).toBe(false);
    expect(missing.problems).toContain("In pesto: cheese has no price");
  });

  it("reports a recipe that ends up using itself instead of looping", () => {
    const a = recipe("a", [line({ subRecipeId: "b" }, 10, "g")], { kind: "prep", yieldMilli: 100_000n, yieldUnit: "g" });
    const b = recipe("b", [line({ subRecipeId: "a" }, 10, "g")], { kind: "prep", yieldMilli: 100_000n, yieldUnit: "g" });
    const costs = run([], [a, b]);
    expect(costs.get("a")!.complete).toBe(false);
    expect(costs.get("a")!.problems.join(" ")).toMatch(/uses .* again/);
  });
});

describe("food cost and suggested price", () => {
  const sheet = { targetBp: 3000, overheadBp: 2200, vatBp: null };

  it("reproduces the costing sheet's suggested price and shows what it really targets", () => {
    const fc = foodCost(1_858_180n, 0n, 8_000_000n, sheet);
    expect(fc.sheetPriceMicros).toBe(7_556_599n); // (1.85818) × 1.22 ÷ 0.30 = 7.5565987
    expect(fc.priceAtTargetMicros).toBe(6_193_933n); // 1.85818 ÷ 0.30
    expect(fc.foodCostBp).toBe(2323); // 23.23% at $8
    expect(fc.marginMicros).toBe(8_000_000n - 1_858_180n);
    // At the sheet's suggested price, food cost lands near 24.6%, not 30%.
    expect(foodCost(1_858_180n, 0n, fc.sheetPriceMicros, sheet).foodCostBp).toBe(2459);
  });

  it("measures food cost on the price without VAT when menu prices include it", () => {
    const fc = foodCost(1_858_180n, 0n, 8_000_000n, { ...sheet, vatBp: 1100 });
    expect(fc.netPriceMicros).toBe(7_207_207n);
    expect(fc.foodCostBp).toBe(2578);
    expect(fc.priceAtTargetMicros).toBe(6_875_266n); // back to a menu price with VAT
  });

  it("counts packaging in the margin and the suggested price, and flags dishes over target", () => {
    const fc = foodCost(2_640_000n, 5953n, 3_500_000n, sheet);
    expect(fc.overTarget).toBe(true);
    expect(fc.foodCostBp).toBe(7543);
    expect(fc.marginMicros).toBe(3_500_000n - 2_640_000n - 595_300n);
  });

  it("formats small costs so they don't read as free", () => {
    expect(formatMicros(800n)).toBe("$0.0008");
    expect(formatMicros(533_400n)).toBe("$0.53");
    expect(formatMicros(7_556_599n)).toBe("$7.56");
    expect(formatBp(2459)).toBe("24.59%");
  });
});

describe("empty recipes", () => {
  it("never shows a recipe without ingredients as costed at zero", () => {
    const empty = run([], [recipe("lady fingers", [])]).get("lady fingers")!;
    expect(empty.complete).toBe(false);
    expect(empty.problems).toEqual(["No ingredients yet"]);
  });
});
