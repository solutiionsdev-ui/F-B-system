// Reading a menu costing workbook (Kitchen, stage A): a price list sheet, a
// recipes sheet with one row per ingredient line, and a menu costs sheet with
// selling prices, packaging, overhead and target food cost. Pure: turns the
// sheets' cells into a plan (ingredients, recipes, settings) plus every issue
// found, which a person checks before anything is saved.
//
// What it deliberately does differently from the spreadsheet:
// - A sauce or other prep that has its own recipe is costed from that recipe
//   (so it follows ingredient prices), not from a price typed into the list.
// - Nothing missing is costed as zero: missing prices and units are issues.
// - Names are matched ignoring case and stray spaces.
import { costRecipes, type BaseUnit, type CostIngredient, type CostRecipe, type LineUnit, type Price } from "./costing";

export type Sheet = { name: string; rows: string[][] };

export type IssueLevel = "error" | "warning" | "info";
export type Issue = { level: IssueLevel; sheet: string; row: number | null; subject: string; message: string };

export type PlanIngredient = {
  key: string;
  name: string;
  baseUnit: BaseUnit;
  price: Price | null;
  supplier: string | null;
  category: string | null;
  row: number;
};

export type PlanLine = { ref: { type: "ingredient" | "prep"; key: string }; quantityMilli: string; unit: LineUnit; row: number };

export type PlanRecipe = {
  key: string;
  name: string;
  kind: "dish" | "prep";
  sellingPriceE4: string | null;
  packagingE4: string;
  targetBp: number | null;
  yieldMilli: string | null;
  yieldUnit: BaseUnit | null;
  yieldEstimated: boolean;
  lines: PlanLine[];
};

/** JSON-safe (bigints as strings) so it can be stored as a draft. */
export type Plan = {
  ingredients: PlanIngredient[];
  recipes: PlanRecipe[];
  settings: { targetBp: number | null; overheadBp: number | null };
  issues: Issue[];
};

export const keyOf = (name: string) => cleanName(name).toLowerCase();
export function cleanName(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

/**
 * A decimal as written in a cell ("26.67", "1.0000000000000001E-3") scaled by
 * 10^scale, rounded half away from zero. Null when it isn't a number.
 */
export function decimalToScaled(raw: string | null | undefined, scale: number): bigint | null {
  if (raw == null) return null;
  const m = /^\s*([+-])?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?\s*$/i.exec(String(raw));
  if (!m || ((m[2] ?? "") === "" && (m[3] ?? "") === "")) return null;
  const digits = (m[2] || "0") + (m[3] ?? "");
  const exp = Number(m[4] ?? 0) - (m[3] ?? "").length + scale;
  let v: bigint;
  if (exp >= 0) v = BigInt(digits) * 10n ** BigInt(exp);
  else {
    const d = 10n ** BigInt(-exp);
    const n = BigInt(digits);
    v = (n * 2n + d) / (d * 2n);
  }
  return m[1] === "-" ? -v : v;
}

/** How a price list quotes its unit: kg, L, piece, or a pack such as "unit (30g)". */
export function parsePricingUnit(raw: string): { baseUnit: BaseUnit; perMilli: bigint; label: string } | null {
  const u = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (["kg", "kilo", "kilogram", "kgs"].includes(u)) return { baseUnit: "g", perMilli: 1_000_000n, label: "kg" };
  if (["g", "gr", "gram", "grams"].includes(u)) return { baseUnit: "g", perMilli: 1000n, label: "g" };
  if (["l", "lt", "ltr", "litre", "liter"].includes(u)) return { baseUnit: "ml", perMilli: 1_000_000n, label: "L" };
  if (u === "ml") return { baseUnit: "ml", perMilli: 1000n, label: "ml" };
  if (["unit", "pc", "pcs", "piece", "pieces", "each"].includes(u)) return { baseUnit: "unit", perMilli: 1000n, label: "piece" };
  const pack = /^(?:unit|pack|bunch|piece|box)\s*\(\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\s*\)$/.exec(u);
  if (pack) {
    const qty = decimalToScaled(pack[1], 3)!;
    const unit = pack[2];
    const base: BaseUnit = unit === "g" || unit === "kg" ? "g" : "ml";
    const factor = unit === "kg" || unit === "l" ? 1000n : 1n;
    return { baseUnit: base, perMilli: qty * factor, label: `${raw.trim().split(/\s*\(/)[0] || "unit"} (${pack[1]} ${unit === "l" ? "L" : unit})` };
  }
  return null;
}

function parseLineUnit(raw: string): LineUnit | null {
  const u = raw.trim().toLowerCase();
  if (u === "g" || u === "gr" || u === "grams") return "g";
  if (u === "kg") return "kg";
  if (u === "ml") return "ml";
  if (u === "l" || u === "lt" || u === "litre" || u === "liter") return "l";
  if (["unit", "units", "pc", "pcs", "piece", "pieces"].includes(u)) return "unit";
  return null;
}

/** Finds a sheet by any of its likely names, and its columns by header words. */
function findSheet(sheets: Sheet[], names: string[]) {
  return sheets.find((s) => names.includes(s.name.toLowerCase().replace(/[\s_-]/g, "")));
}
function columns(header: string[], wanted: Record<string, RegExp>) {
  const out: Record<string, number> = {};
  for (const [k, re] of Object.entries(wanted)) {
    const i = header.findIndex((h, idx) => re.test(h ?? "") && !Object.values(out).includes(idx));
    out[k] = i;
  }
  return out;
}
const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").toString() : "");

export function readWorkbook(sheets: Sheet[]): Plan {
  const issues: Issue[] = [];
  const issue = (level: IssueLevel, sheet: string, row: number | null, subject: string, message: string) =>
    issues.push({ level, sheet, row, subject, message });

  const priceSheet = findSheet(sheets, ["pricelist", "prices", "ingredients", "ingredientprices"]);
  const recipeSheet = findSheet(sheets, ["recipes", "recipe"]);
  const menuSheet = findSheet(sheets, ["menucosts", "menucost", "menu", "costs"]);
  if (!priceSheet || !recipeSheet) {
    throw new Error("This doesn't look like a menu costing workbook: it needs a price list sheet (PriceList) and a Recipes sheet.");
  }

  // ---- price list
  const ph = priceSheet.rows[0] ?? [];
  const pc = columns(ph, { name: /ingredient|item|name/i, unit: /unit/i, price: /price/i, notes: /note|supplier/i });
  if (pc.name < 0 || pc.unit < 0 || pc.price < 0) throw new Error(`The ${priceSheet.name} sheet needs Ingredient, Pricing Unit and Price columns.`);
  const priced = new Map<string, PlanIngredient>();
  priceSheet.rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const name = cleanName(cell(r, pc.name));
    if (!name) return;
    const key = name.toLowerCase();
    const unitRaw = cell(r, pc.unit);
    const unit = parsePricingUnit(unitRaw);
    if (!unit) {
      issue("error", priceSheet.name, row, name, unitRaw.trim() ? `Pricing unit "${unitRaw.trim()}" isn't one FINCTRL knows (kg, g, L, ml, unit, or a pack like "unit (30g)").` : "No pricing unit.");
      return;
    }
    const priceE4 = decimalToScaled(cell(r, pc.price), 4);
    if (priceE4 != null && priceE4 <= 0n) issue("warning", priceSheet.name, row, name, "Price is zero or negative; left without a price.");
    const price = priceE4 != null && priceE4 > 0n ? { currency: "USD" as const, priceE4, perMilli: unit.perMilli, packLabel: unit.label } : null;
    if (!price && priceE4 == null) issue("warning", priceSheet.name, row, name, "No price. Dishes using it can't be fully costed until it has one.");
    if (priced.has(key)) issue("warning", priceSheet.name, row, name, `Listed twice (also row ${priced.get(key)!.row}); this row is used.`);
    const supplier = cleanName(cell(r, pc.notes)) || null;
    priced.set(key, { key, name, baseUnit: unit.baseUnit, price, supplier, category: null, row });
  });

  // ---- recipes: group the lines by dish
  const rh = recipeSheet.rows[0] ?? [];
  const rc = columns(rh, { dish: /menu item|dish|recipe/i, ing: /ingredient/i, qty: /^\s*qty\s*$|quantity/i, unit: /qty unit|unit/i });
  if (rc.dish < 0 || rc.ing < 0 || rc.qty < 0 || rc.unit < 0) throw new Error(`The ${recipeSheet.name} sheet needs Menu Item, Ingredient, Qty and Qty Unit columns.`);
  type RawLine = { ing: string; qtyRaw: string; unitRaw: string; row: number };
  const byDish = new Map<string, { name: string; lines: RawLine[]; firstRow: number }>();
  recipeSheet.rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const dish = cleanName(cell(r, rc.dish));
    const ingName = cleanName(cell(r, rc.ing));
    if (!dish && !ingName) return;
    if (!dish) {
      issue("warning", recipeSheet.name, row, ingName, "Ingredient line with no dish name; skipped.");
      return;
    }
    const key = dish.toLowerCase();
    if (!byDish.has(key)) byDish.set(key, { name: dish, lines: [], firstRow: row });
    if (!ingName) {
      issue("warning", recipeSheet.name, row, dish, "Line with no ingredient; skipped.");
      return;
    }
    byDish.get(key)!.lines.push({ ing: ingName, qtyRaw: cell(r, rc.qty), unitRaw: cell(r, rc.unit), row });
  });

  // ---- menu costs
  const menu = new Map<string, { price: bigint | null; packaging: bigint; target: number | null; overhead: number | null; row: number }>();
  const packaging: { name: string; priceE4: bigint; row: number }[] = [];
  if (menuSheet) {
    const mh = menuSheet.rows[0] ?? [];
    const mc = columns(mh, { dish: /menu item|dish/i, packaging: /packaging/i, overhead: /overhead/i, target: /target/i, price: /selling/i });
    menuSheet.rows.slice(1).forEach((r, i) => {
      const row = i + 2;
      const dish = cleanName(cell(r, mc.dish));
      const bp = (raw: string) => {
        const v = decimalToScaled(raw, 4);
        return v == null ? null : Number(v); // 0.3 -> 3000 bp
      };
      if (dish) {
        const price = decimalToScaled(cell(r, mc.price), 4);
        menu.set(dish.toLowerCase(), {
          price: price != null && price > 0n ? price : null,
          packaging: decimalToScaled(cell(r, mc.packaging), 4) ?? 0n,
          target: bp(cell(r, mc.target)),
          overhead: bp(cell(r, mc.overhead)),
          row,
        });
      }
      // A side list of packaging items next to the table (a name, then its price).
      const known = new Set(Object.values(mc));
      for (let c = 0; c + 1 < r.length; c++) {
        if (known.has(c) || known.has(c + 1)) continue;
        const label = cleanName(r[c] ?? "");
        const v = decimalToScaled(r[c + 1], 4);
        if (label && /[a-z]/i.test(label) && v != null && v > 0n && decimalToScaled(label, 4) == null) packaging.push({ name: label, priceE4: v, row });
      }
    });
  }

  // ---- which recipes are preps: used as an ingredient by another recipe, and not sold on their own
  const usedAs = new Map<string, LineUnit[]>();
  for (const d of byDish.values()) {
    for (const l of d.lines) {
      const k = l.ing.toLowerCase();
      if (byDish.has(k) && k !== d.name.toLowerCase()) {
        const u = parseLineUnit(l.unitRaw);
        usedAs.set(k, [...(usedAs.get(k) ?? []), ...(u ? [u] : [])]);
      }
    }
  }
  const isPrep = (k: string) => usedAs.has(k) && !(menu.get(k)?.price) && !(priced.has(k) && menu.get(k)?.price);

  // A name both priced in the list and sold as a dish (e.g. a raw ingredient and the dish named after it)
  // stays an ingredient where it's used inside another recipe.
  const ingredients = new Map(priced);
  for (const [k, ing] of priced) {
    if (byDish.has(k) && isPrep(k)) {
      ingredients.delete(k);
      issue(
        "info",
        priceSheet.name,
        ing.row,
        ing.name,
        `Has its own recipe, so it's costed from that recipe${ing.price ? ` instead of the typed price` : ""}. It follows its ingredients' prices from now on.`,
      );
    }
  }

  const recipes: PlanRecipe[] = [];
  for (const [key, d] of byDish) {
    const prep = isPrep(key);
    const m = menu.get(key);
    const lines: PlanLine[] = [];
    for (const l of d.lines) {
      let unit = parseLineUnit(l.unitRaw);
      const qty = decimalToScaled(l.qtyRaw, 3);
      // The sheet's own formula counts a blank unit as pieces when the ingredient is priced per piece; do the same, and say so.
      if (!unit && !l.unitRaw.trim() && ingredients.get(l.ing.toLowerCase())?.baseUnit === "unit") {
        unit = "unit";
        issue("warning", recipeSheet.name, l.row, d.name, `${l.ing}: no unit; taken as pieces, since it's priced per piece.`);
      }
      if (!unit) {
        issue("error", recipeSheet.name, l.row, d.name, `${l.ing}: ${l.unitRaw.trim() ? `unit "${l.unitRaw.trim()}" isn't g, kg, ml, L or unit` : "no unit"}; line skipped.`);
        continue;
      }
      if (qty == null || qty < 0n) {
        issue("error", recipeSheet.name, l.row, d.name, `${l.ing}: no quantity; line skipped.`);
        continue;
      }
      if (qty === 0n) issue("warning", recipeSheet.name, l.row, d.name, `${l.ing}: quantity is 0.`);
      const k = l.ing.toLowerCase();
      if (byDish.has(k) && isPrep(k) && k !== key) {
        lines.push({ ref: { type: "prep", key: k }, quantityMilli: qty.toString(), unit, row: l.row });
        continue;
      }
      if (!ingredients.has(k)) {
        const base: BaseUnit = unit === "g" || unit === "kg" ? "g" : unit === "unit" ? "unit" : "ml";
        ingredients.set(k, { key: k, name: l.ing, baseUnit: base, price: null, supplier: null, category: null, row: l.row });
        issue("warning", recipeSheet.name, l.row, l.ing, `Not in the price list; added without a price (used in ${d.name}).`);
      }
      lines.push({ ref: { type: "ingredient", key: k }, quantityMilli: qty.toString(), unit, row: l.row });
    }
    if (lines.length === 0) issue("warning", recipeSheet.name, d.firstRow, d.name, "No usable ingredient lines.");

    let yieldMilli: string | null = null;
    let yieldUnit: BaseUnit | null = null;
    let yieldEstimated = false;
    if (prep) {
      // The batch size isn't in the sheet: estimate it from the ingredients, in the unit other recipes use, and flag it.
      const uses = usedAs.get(key) ?? [];
      const dim = (u: LineUnit) => (u === "g" || u === "kg" ? "g" : u === "ml" || u === "l" ? "ml" : "unit");
      const counts = { g: 0, ml: 0, unit: 0 } as Record<BaseUnit, number>;
      for (const u of uses) counts[dim(u)]++;
      yieldUnit = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as BaseUnit) ?? "g";
      if (yieldUnit === "unit") {
        yieldUnit = null;
        issue("error", recipeSheet.name, d.firstRow, d.name, "Used by the piece in other recipes: set how many pieces one batch makes.");
      } else {
        let total = 0n;
        let pieces = false;
        for (const l of lines) {
          if (l.unit === "unit") pieces = true;
          else total += BigInt(l.quantityMilli) * (l.unit === "kg" || l.unit === "l" ? 1000n : 1n);
        }
        if (total > 0n) {
          yieldMilli = total.toString();
          yieldEstimated = true;
          const shown = `${Number(total / 1000n).toLocaleString("en-US")} ${yieldUnit}`;
          issue(
            "warning",
            recipeSheet.name,
            d.firstRow,
            d.name,
            `Batch size not in the sheet: estimated at ${shown} from its ingredients (ml counted as g${pieces ? ", pieces left out" : ""}). Weigh a batch and correct it.`,
          );
        } else {
          yieldUnit = null;
          issue("error", recipeSheet.name, d.firstRow, d.name, "Set how much one batch makes.");
        }
      }
    }

    if (!prep && !m?.price) issue("warning", menuSheet?.name ?? recipeSheet.name, m?.row ?? d.firstRow, d.name, "No selling price yet, so no food cost %.");
    recipes.push({
      key,
      name: d.name,
      kind: prep ? "prep" : "dish",
      sellingPriceE4: !prep && m?.price ? m.price.toString() : null,
      packagingE4: (m?.packaging ?? 0n).toString(),
      targetBp: null,
      yieldMilli,
      yieldUnit,
      yieldEstimated,
      lines,
    });
  }

  for (const [k, m] of menu) {
    if (!byDish.has(k)) issue("warning", menuSheet!.name, m.row, k, "In the menu costs but has no recipe lines; skipped.");
  }

  // A recipe nothing uses and nothing sells, whose name is a near-miss of a price-list item, is probably a typo.
  for (const r of recipes) {
    if (r.kind !== "dish" || r.sellingPriceE4 || usedAs.has(r.key)) continue;
    const near = [...priced.values()].find((i) => i.key !== r.key && Math.abs(i.key.length - r.key.length) <= 2 && editDistance(i.key, r.key) <= 2);
    if (near) {
      issue(
        "warning",
        recipeSheet.name,
        byDish.get(r.key)!.firstRow,
        r.name,
        `Looks like "${near.name}" in the price list, which the dishes use instead. If they're the same, give them the same name so the recipe is used.`,
      );
    }
  }

  // ---- packaging items listed beside the menu costs
  for (const p of packaging) {
    const k = p.name.toLowerCase();
    if (ingredients.has(k)) continue;
    ingredients.set(k, {
      key: k,
      name: p.name,
      baseUnit: "unit",
      price: { currency: "USD", priceE4: p.priceE4, perMilli: 1000n, packLabel: "piece" },
      supplier: null,
      category: "Packaging",
      row: p.row,
    });
  }
  if (packaging.length) {
    issue("info", menuSheet!.name, packaging[0].row, "Packaging", `${packaging.length} packaging items added as ingredients (${packaging.map((p) => p.name).join(", ")}). Add them to delivery dishes' packaging.`);
  }

  // ---- settings: the most common target and overhead; dishes that differ keep their own target
  const mode = (vals: (number | null)[]) => {
    const c = new Map<number, number>();
    for (const v of vals) if (v != null) c.set(v, (c.get(v) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const targetBp = mode([...menu.values()].map((m) => m.target));
  const overheadBp = mode([...menu.values()].map((m) => m.overhead));
  for (const r of recipes) {
    const t = menu.get(r.key)?.target;
    if (t != null && targetBp != null && t !== targetBp) r.targetBp = t;
  }
  const odd = [...menu.entries()].filter(([, m]) => m.overhead != null && overheadBp != null && m.overhead !== overheadBp);
  if (odd.length) issue("warning", menuSheet!.name, odd[0][1].row, "Overhead", `Overhead differs on ${odd.length} dishes; the business-wide ${overheadBp! / 100}% is used.`);
  issue("info", priceSheet.name, null, "Currency", "Prices are read as US dollars.");

  return {
    ingredients: [...ingredients.values()],
    recipes,
    settings: { targetBp, overheadBp },
    issues,
  };
}

/** Letters to add, drop or change to turn one name into another. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The plan as costing input, to show every dish's cost before anything is saved. */
export function planCosts(plan: Plan) {
  const ings = new Map<string, CostIngredient>();
  for (const i of plan.ingredients) {
    ings.set(`i:${i.key}`, { id: `i:${i.key}`, name: i.name, baseUnit: i.baseUnit, gramsPerMlE4: null, gramsPerUnitMilli: null, yieldBp: 10000, price: i.price && { ...i.price, priceE4: BigInt(i.price.priceE4), perMilli: BigInt(i.price.perMilli) } });
  }
  const recs = new Map<string, CostRecipe>();
  for (const r of plan.recipes) {
    recs.set(`r:${r.key}`, {
      id: `r:${r.key}`,
      name: r.name,
      kind: r.kind,
      yieldMilli: r.yieldMilli ? BigInt(r.yieldMilli) : null,
      yieldUnit: r.yieldUnit,
      yieldEstimated: r.yieldEstimated,
      lines: r.lines.map((l) => ({
        ingredientId: l.ref.type === "ingredient" ? `i:${l.ref.key}` : null,
        subRecipeId: l.ref.type === "prep" ? `r:${l.ref.key}` : null,
        quantityMilli: BigInt(l.quantityMilli),
        unit: l.unit,
      })),
    });
  }
  return costRecipes(ings, recs, null);
}

/** Bigints in prices become strings, so the plan can be stored as JSON. */
export function planToJson(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
