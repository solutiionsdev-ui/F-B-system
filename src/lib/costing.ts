// Recipe costing and food cost (Kitchen, stage A). Pure functions: the
// database supplies ingredients, prices and recipe versions; this works out
// what each line, batch and dish costs.
//
// Exact arithmetic only. Quantities are thousandths of a unit ("milli"),
// prices ten-thousandths of a currency ("e4"), percentages basis points
// ("bp", 10000 = 100%), and costs come out in millionths of a US dollar
// ("micros"), rounded once per line. Nothing is ever costed at zero because
// something is missing: a line that can't be costed is reported as a problem,
// and the dish is marked incomplete.
import { divRound, formatScaled, RATE_SCALE, type Currency } from "./money";

export type BaseUnit = "g" | "ml" | "unit";
export type LineUnit = "g" | "kg" | "ml" | "l" | "unit";

export const LINE_UNITS: LineUnit[] = ["g", "kg", "ml", "l", "unit"];
export const BASE_UNITS: BaseUnit[] = ["g", "ml", "unit"];
export const UNIT_LABEL: Record<LineUnit, string> = { g: "g", kg: "kg", ml: "ml", l: "L", unit: "piece" };

export type Price = { currency: Currency; priceE4: bigint; perMilli: bigint; packLabel: string };

export type CostIngredient = {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** Weight of 1 ml, ×10^4 (olive oil about 9,100). */
  gramsPerMlE4: bigint | null;
  /** Weight of one piece in thousandths of a gram (an egg about 60,000). */
  gramsPerUnitMilli: bigint | null;
  /** Usable share after trimming or peeling, in basis points. */
  yieldBp: number;
  price: Price | null;
};

export type CostLine = { ingredientId: string | null; subRecipeId: string | null; quantityMilli: bigint; unit: LineUnit };

export type CostRecipe = {
  id: string;
  name: string;
  kind: "dish" | "prep";
  /** Preps: one batch makes this much. */
  yieldMilli: bigint | null;
  yieldUnit: BaseUnit | null;
  yieldEstimated: boolean;
  lines: CostLine[];
};

export type LineResult = {
  line: CostLine;
  name: string;
  kind: "ingredient" | "prep";
  costMicros: bigint | null;
  problem: string | null;
};

export type RecipeCost = {
  /** Total of the lines that could be costed; the true cost when `complete`. */
  costMicros: bigint;
  complete: boolean;
  lines: LineResult[];
  /** Problems on this recipe's own lines, and in any prep it uses. */
  problems: string[];
  warnings: string[];
};

const MICROS = 1_000_000n;
const E4 = 10_000n;

// ---------------------------------------------------------------- units

type Dim = "mass" | "volume" | "count";
const DIM: Record<LineUnit, Dim> = { g: "mass", kg: "mass", ml: "volume", l: "volume", unit: "count" };
/** Thousandths of the dimension's base (g, ml, piece) in one thousandth of the line unit. */
const FACTOR: Record<LineUnit, bigint> = { g: 1n, kg: 1000n, ml: 1n, l: 1000n, unit: 1n };

/** A quantity as an exact fraction, in thousandths of a base unit. */
type Q = { num: bigint; den: bigint };

type Conversions = { gramsPerMlE4: bigint | null; gramsPerUnitMilli: bigint | null };

/**
 * A line's quantity in thousandths of `target`, or a sentence saying why it
 * can't be converted. Weight and volume convert through the density; pieces
 * through the weight of one piece.
 */
export function convertQuantity(quantityMilli: bigint, unit: LineUnit, target: BaseUnit, conv: Conversions, what: string): Q | string {
  const from = DIM[unit];
  const to: Dim = target === "g" ? "mass" : target === "ml" ? "volume" : "count";
  let q: Q = { num: quantityMilli * FACTOR[unit], den: 1n };
  if (from === to) return q;
  // Into grams first.
  if (from === "volume") {
    if (!conv.gramsPerMlE4) return `${what} is measured by volume here but by weight elsewhere; set its weight per ml`;
    q = { num: q.num * conv.gramsPerMlE4, den: q.den * E4 };
  } else if (from === "count") {
    if (!conv.gramsPerUnitMilli) return `${what} is counted in pieces here; set the weight of one piece`;
    q = { num: q.num * conv.gramsPerUnitMilli, den: q.den * 1000n };
  }
  if (to === "mass") return q;
  if (to === "volume") {
    if (!conv.gramsPerMlE4) return `${what} is measured by weight here but priced by volume; set its weight per ml`;
    return { num: q.num * E4, den: q.den * conv.gramsPerMlE4 };
  }
  if (!conv.gramsPerUnitMilli) return `${what} is measured by weight here but priced per piece; set the weight of one piece`;
  return { num: q.num * 1000n, den: q.den * conv.gramsPerUnitMilli };
}

// ---------------------------------------------------------------- costing

/** US-dollar micros for a price applied to an exact quantity of its base unit, after the usable yield. */
function priceMicros(q: Q, price: Price, yieldBp: number, rate: bigint | null): bigint | string {
  // cost = qty / per × price / yield
  let num = q.num * price.priceE4 * MICROS;
  let den = q.den * price.perMilli * BigInt(yieldBp);
  if (price.currency === "LBP") {
    if (!rate) return "priced in LBP but there's no exchange rate to convert it";
    num *= RATE_SCALE;
    den *= rate;
  }
  return divRound(num, den);
}

/**
 * Costs every recipe. `rate` (LBP per USD ×10^4) converts LBP prices; costs
 * are in USD. Preps are costed per batch and shared, so a sauce used in ten
 * dishes is worked out once, and a recipe that ends up using itself is
 * reported instead of looping.
 */
export function costRecipes(
  ingredients: Map<string, CostIngredient>,
  recipes: Map<string, CostRecipe>,
  rate: bigint | null,
): Map<string, RecipeCost> {
  const done = new Map<string, RecipeCost>();
  const visiting = new Set<string>();

  const cost = (id: string): RecipeCost => {
    const cached = done.get(id);
    if (cached) return cached;
    const r = recipes.get(id)!;
    visiting.add(id);
    const lines: LineResult[] = [];
    const problems: string[] = [];
    const warnings: string[] = [];
    let total = 0n;
    for (const line of r.lines) {
      if (line.ingredientId) {
        const ing = ingredients.get(line.ingredientId);
        if (!ing) {
          lines.push({ line, name: "Unknown ingredient", kind: "ingredient", costMicros: null, problem: "This ingredient no longer exists" });
          continue;
        }
        let problem: string | null = null;
        let micros: bigint | null = null;
        if (!ing.price) problem = `${ing.name} has no price`;
        else {
          const q = convertQuantity(line.quantityMilli, line.unit, ing.baseUnit, ing, ing.name);
          if (typeof q === "string") problem = q;
          else {
            const m = priceMicros(q, ing.price, ing.yieldBp, rate);
            if (typeof m === "string") problem = `${ing.name} is ${m}`;
            else micros = m;
          }
        }
        if (problem) problems.push(problem);
        else total += micros!;
        lines.push({ line, name: ing.name, kind: "ingredient", costMicros: micros, problem });
        continue;
      }
      const sub = recipes.get(line.subRecipeId!);
      if (!sub) {
        lines.push({ line, name: "Unknown recipe", kind: "prep", costMicros: null, problem: "This prep no longer exists" });
        problems.push("A prep used here no longer exists");
        continue;
      }
      if (visiting.has(sub.id)) {
        const p = `${sub.name} uses ${r.name}, which uses ${sub.name} again`;
        lines.push({ line, name: sub.name, kind: "prep", costMicros: null, problem: p });
        problems.push(p);
        continue;
      }
      const subCost = cost(sub.id);
      let problem: string | null = null;
      let micros: bigint | null = null;
      if (!sub.yieldMilli || !sub.yieldUnit) problem = `${sub.name} has no batch size, so a portion of it can't be costed`;
      else {
        const q = convertQuantity(line.quantityMilli, line.unit, sub.yieldUnit, { gramsPerMlE4: null, gramsPerUnitMilli: null }, sub.name);
        if (typeof q === "string") problem = `${sub.name} makes ${sub.yieldUnit === "unit" ? "pieces" : sub.yieldUnit}; this line uses ${UNIT_LABEL[line.unit]}`;
        else micros = divRound(q.num * subCost.costMicros, q.den * sub.yieldMilli);
      }
      if (problem) problems.push(problem);
      else total += micros!;
      if (!subCost.complete) problems.push(...subCost.problems.map((p) => `In ${sub.name}: ${p}`));
      if (sub.yieldEstimated) warnings.push(`${sub.name}'s batch size is an estimate; confirm it`);
      warnings.push(...subCost.warnings);
      lines.push({ line, name: sub.name, kind: "prep", costMicros: micros, problem });
    }
    if (r.lines.length === 0) problems.push("No ingredients yet");
    visiting.delete(id);
    const result: RecipeCost = {
      costMicros: total,
      complete: problems.length === 0,
      lines,
      problems: [...new Set(problems)],
      warnings: [...new Set(warnings)],
    };
    done.set(id, result);
    return result;
  };

  for (const id of recipes.keys()) cost(id);
  return done;
}

/** Cost of one piece / kg / L of a prep from its batch cost, in micros per base unit (×1000 for a kg or L). */
export function costPerYieldUnit(batchMicros: bigint, yieldMilli: bigint, unit: BaseUnit): { micros: bigint; per: string } {
  const per = unit === "unit" ? 1000n : 1_000_000n; // one piece, or one kg / L
  return { micros: divRound(batchMicros * per, yieldMilli), per: unit === "unit" ? "piece" : unit === "g" ? "kg" : "L" };
}

// ---------------------------------------------------------------- food cost

export type FoodCostSettings = {
  /** Target food cost, bp of the menu price without VAT. */
  targetBp: number;
  /** Overhead markup used by the costing sheet's suggested price, bp. */
  overheadBp: number;
  /** VAT included in menu prices, bp; null when not set (prices taken as they are). */
  vatBp: number | null;
};

export type FoodCost = {
  /** The menu price in USD micros, and without VAT when VAT is set. */
  priceMicros: bigint;
  netPriceMicros: bigint;
  /** Ingredient cost ÷ net price, bp. */
  foodCostBp: number;
  /** Net price − ingredients − packaging. */
  marginMicros: bigint;
  /** Menu price that puts food cost (with packaging) exactly at the target. */
  priceAtTargetMicros: bigint;
  /** The costing sheet's method: (cost + packaging) × (1 + overhead) ÷ target, as a menu price. */
  sheetPriceMicros: bigint;
  overTarget: boolean;
};

/** USD micros for a price in e4 of its currency. */
export function priceToMicros(priceE4: bigint, currency: Currency, rate: bigint | null): bigint | null {
  if (currency === "USD") return priceE4 * 100n;
  if (!rate) return null;
  return divRound(priceE4 * 100n * RATE_SCALE, rate);
}

export function foodCost(costMicros: bigint, packagingE4: bigint, priceMicros: bigint, s: FoodCostSettings): FoodCost {
  const packMicros = packagingE4 * 100n;
  const vat = BigInt(10000 + (s.vatBp ?? 0));
  const net = divRound(priceMicros * 10000n, vat);
  const target = BigInt(s.targetBp);
  const withVat = (m: bigint) => divRound(m * vat, 10000n);
  const foodCostBp = net > 0n ? Number(divRound(costMicros * 10000n, net)) : 0;
  return {
    priceMicros,
    netPriceMicros: net,
    foodCostBp,
    marginMicros: net - costMicros - packMicros,
    priceAtTargetMicros: withVat(divRound((costMicros + packMicros) * 10000n, target)),
    sheetPriceMicros: withVat(divRound((costMicros + packMicros) * BigInt(10000 + s.overheadBp), target)),
    overTarget: foodCostBp > s.targetBp,
  };
}

// ---------------------------------------------------------------- formatting

/** "$1.86", or "$0.0008" for amounts under a cent so small lines don't read as free. */
export function formatMicros(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const sign = neg ? "−" : "";
  if (abs !== 0n && abs < 10_000n) return `${sign}$${formatScaled(abs, 6, 4).replace(/(\.\d{4})\d*$/, "$1")}`;
  return `${sign}$${formatScaled(divRound(abs, 10_000n), 2, 2)}`;
}

/** "30%", "24.6%". */
export function formatBp(bp: number): string {
  return `${formatScaled(BigInt(Math.round(bp)), 2)}%`;
}

/** "20 g", "1.5 kg", "2 pieces". */
export function formatQuantity(quantityMilli: bigint, unit: LineUnit | BaseUnit): string {
  const n = formatScaled(quantityMilli, 3);
  if (unit === "unit") return `${n} ${quantityMilli === 1000n ? "piece" : "pieces"}`;
  return `${n} ${UNIT_LABEL[unit]}`;
}

/** What a price buys, in words: "$26.67 per kg", "LBP 450,000 per kg", "$0.40 per bunch (30 g)". */
export function formatPrice(p: Price): string {
  const amount =
    p.currency === "USD" ? `$${formatScaled(p.priceE4, 4, 2)}` : `LBP ${formatScaled(divRound(p.priceE4, E4), 0)}`;
  return `${amount} per ${p.packLabel}`;
}
