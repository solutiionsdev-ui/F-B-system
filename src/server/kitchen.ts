// Kitchen, stage A: ingredients and their price history, recipes and their
// versions, food cost, and importing a menu costing workbook. Framework-free
// like operations.ts; every read and write runs as the signed-in person under
// row-level security. Costs are worked out by lib/costing.ts only.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type DB, type TenantScope, type Tx, withTenant } from "@/db/database";
import {
  ingredientPrices,
  ingredients,
  organizations,
  recipeImports,
  recipeLines,
  recipes,
  recipeVersions,
  users,
  type BaseUnit,
  type Currency,
  type RecipeUnit,
} from "@/db/schema";
import {
  BASE_UNITS,
  costRecipes,
  foodCost,
  LINE_UNITS,
  priceToMicros,
  type CostIngredient,
  type CostRecipe,
  type FoodCostSettings,
  type Price,
  type RecipeCost,
} from "@/lib/costing";
import { cleanName, keyOf, planCosts, planToJson, readWorkbook, type Plan, type Sheet } from "@/lib/menu-workbook";
import { MoneyError, parseDecimal, parseRate } from "@/lib/money";
import { can } from "@/lib/permissions";
import { currentRate, requirePermission, UserError } from "./operations";

const MAX_BYTES = 5 * 1024 * 1024;

function requireRecipes(scope: TenantScope) {
  requirePermission(scope, "manage_recipes", "change recipes and ingredient prices");
}

function decimal(raw: string, decimals: number, label: string, opts: { optional?: boolean; min?: bigint } = {}): bigint | null {
  if (!raw.trim()) {
    if (opts.optional) return null;
    throw new UserError(`Enter the ${label}.`);
  }
  try {
    const v = parseDecimal(raw, decimals, label);
    if (opts.min != null && v < opts.min) throw new UserError(`The ${label} must be more than zero.`);
    return v;
  } catch (e) {
    if (e instanceof MoneyError) throw new UserError(`${e.message}.`);
    throw e;
  }
}

/** "30" or "30%" to basis points. */
function percent(raw: string, label: string, opts: { optional?: boolean; min?: number; max?: number } = {}): number | null {
  const v = decimal(raw.replace("%", ""), 2, label, { optional: opts.optional });
  if (v == null) return null;
  const bp = Number(v);
  if (bp < (opts.min ?? 0) || bp > (opts.max ?? 10000)) {
    throw new UserError(`The ${label} must be between ${(opts.min ?? 0) / 100}% and ${(opts.max ?? 10000) / 100}%.`);
  }
  return bp;
}

// ---------------------------------------------------------------- loading everything for costing

async function loadKitchen(tx: Tx) {
  const ingRows = await tx.select().from(ingredients).orderBy(asc(ingredients.name));
  const priceRows = await tx
    .selectDistinctOn([ingredientPrices.ingredientId])
    .from(ingredientPrices)
    .orderBy(ingredientPrices.ingredientId, desc(ingredientPrices.effectiveAt), desc(ingredientPrices.createdAt));
  const recRows = await tx.select().from(recipes).orderBy(asc(recipes.name));
  const versions = await tx
    .selectDistinctOn([recipeVersions.recipeId])
    .from(recipeVersions)
    .orderBy(recipeVersions.recipeId, desc(recipeVersions.version));
  const lines = versions.length
    ? await tx.select().from(recipeLines).where(inArray(recipeLines.versionId, versions.map((v) => v.id))).orderBy(asc(recipeLines.position))
    : [];
  const [org] = await tx
    .select({ targetBp: organizations.foodCostTargetBp, overheadBp: organizations.overheadBp, vatBp: organizations.menuVatBp })
    .from(organizations);
  const rateRow = await currentRate(tx);
  const rate = rateRow ? parseRate(rateRow.lbpPerUsd) : null;

  const priceOf = new Map(priceRows.map((p) => [p.ingredientId, p]));
  const costIngredients = new Map<string, CostIngredient>(
    ingRows.map((i) => {
      const p = priceOf.get(i.id);
      return [
        i.id,
        {
          id: i.id,
          name: i.name,
          baseUnit: i.baseUnit,
          gramsPerMlE4: i.gramsPerMlE4,
          gramsPerUnitMilli: i.gramsPerUnitMilli,
          yieldBp: i.yieldBp,
          price: p ? { currency: p.currency, priceE4: p.priceE4, perMilli: p.perMilli, packLabel: p.packLabel } : null,
        },
      ];
    }),
  );
  const versionOf = new Map(versions.map((v) => [v.recipeId, v]));
  const linesOf = new Map<string, typeof lines>();
  for (const l of lines) linesOf.set(l.versionId, [...(linesOf.get(l.versionId) ?? []), l]);
  const costRecipesMap = new Map<string, CostRecipe>(
    recRows.map((r) => {
      const v = versionOf.get(r.id);
      return [
        r.id,
        {
          id: r.id,
          name: r.name,
          kind: r.kind,
          yieldMilli: v?.yieldMilli ?? null,
          yieldUnit: v?.yieldUnit ?? null,
          yieldEstimated: v?.yieldEstimated ?? false,
          lines: (v ? (linesOf.get(v.id) ?? []) : []).map((l) => ({
            ingredientId: l.ingredientId,
            subRecipeId: l.subRecipeId,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
          })),
        },
      ];
    }),
  );
  const costs = costRecipes(costIngredients, costRecipesMap, rate);
  const settings: FoodCostSettings = { targetBp: org.targetBp, overheadBp: org.overheadBp, vatBp: org.vatBp };
  return { ingRows, priceOf, recRows, versionOf, linesOf, costIngredients, costRecipesMap, costs, settings, rate };
}

type Kitchen = Awaited<ReturnType<typeof loadKitchen>>;

function dishFoodCost(k: Kitchen, r: Kitchen["recRows"][number], cost: RecipeCost) {
  if (r.kind !== "dish" || r.sellingPriceE4 == null || !r.priceCurrency) return null;
  const price = priceToMicros(r.sellingPriceE4, r.priceCurrency, k.rate);
  if (price == null) return null;
  return foodCost(cost.costMicros, r.packagingE4, price, { ...k.settings, targetBp: r.targetBp ?? k.settings.targetBp });
}

// ---------------------------------------------------------------- reads

/** The Recipes list: dishes and preps, with costs only for people who may see food cost. */
export function listRecipes(db: DB, scope: TenantScope) {
  const showCost = can(scope, "view_food_cost");
  return withTenant(db, scope, async (tx) => {
    const k = await loadKitchen(tx);
    const usedBy = new Map<string, number>();
    for (const r of k.costRecipesMap.values()) for (const l of r.lines) if (l.subRecipeId) usedBy.set(l.subRecipeId, (usedBy.get(l.subRecipeId) ?? 0) + 1);
    return {
      showCost,
      settings: k.settings,
      rows: k.recRows
        .filter((r) => !r.archived)
        .map((r) => {
          const cost = k.costs.get(r.id)!;
          const v = k.versionOf.get(r.id);
          return {
            id: r.id,
            name: r.name,
            kind: r.kind,
            category: r.category,
            lines: k.costRecipesMap.get(r.id)!.lines.length,
            version: v?.version ?? 0,
            yieldMilli: v?.yieldMilli ?? null,
            yieldUnit: v?.yieldUnit ?? null,
            yieldEstimated: v?.yieldEstimated ?? false,
            usedBy: usedBy.get(r.id) ?? 0,
            complete: cost.complete,
            problems: cost.problems.length,
            warnings: cost.warnings.length,
            costMicros: showCost ? cost.costMicros : null,
            priceE4: r.sellingPriceE4,
            priceCurrency: r.priceCurrency,
            targetBp: r.targetBp ?? k.settings.targetBp,
            food: showCost ? dishFoodCost(k, r, cost) : null,
          };
        }),
    };
  });
}

export function getRecipe(db: DB, scope: TenantScope, recipeId: string) {
  const showCost = can(scope, "view_food_cost");
  return withTenant(db, scope, async (tx) => {
    const k = await loadKitchen(tx);
    const r = k.recRows.find((x) => x.id === recipeId);
    if (!r) return null;
    const cost = k.costs.get(r.id)!;
    const history = await tx
      .select({ id: recipeVersions.id, version: recipeVersions.version, note: recipeVersions.note, createdAt: recipeVersions.createdAt, by: users.name })
      .from(recipeVersions)
      .leftJoin(users, eq(users.id, recipeVersions.createdBy))
      .where(eq(recipeVersions.recipeId, r.id))
      .orderBy(desc(recipeVersions.version));
    const usedIn = k.recRows.filter((x) => k.costRecipesMap.get(x.id)!.lines.some((l) => l.subRecipeId === r.id)).map((x) => ({ id: x.id, name: x.name }));
    return {
      showCost,
      recipe: r,
      version: k.versionOf.get(r.id) ?? null,
      lines: cost.lines.map((l) => ({ ...l, costMicros: showCost ? l.costMicros : null })),
      costMicros: showCost ? cost.costMicros : null,
      complete: cost.complete,
      problems: cost.problems,
      warnings: cost.warnings,
      food: showCost ? dishFoodCost(k, r, cost) : null,
      settings: k.settings,
      history,
      usedIn,
      // For the editor.
      options: {
        ingredients: k.ingRows.filter((i) => !i.archived).map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit })),
        preps: k.recRows.filter((x) => x.kind === "prep" && !x.archived && x.id !== r.id).map((x) => ({ id: x.id, name: x.name })),
      },
    };
  });
}

/** What the "new recipe" form offers. */
export function recipeOptions(db: DB, scope: TenantScope) {
  return withTenant(db, scope, async (tx) => {
    const ing = await tx.select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit }).from(ingredients).where(eq(ingredients.archived, false)).orderBy(asc(ingredients.name));
    const preps = await tx.select({ id: recipes.id, name: recipes.name }).from(recipes).where(and(eq(recipes.kind, "prep"), eq(recipes.archived, false))).orderBy(asc(recipes.name));
    return { ingredients: ing, preps };
  });
}

/** The Inventory tab's price list: every ingredient, its current price and where it's used. */
export function listIngredients(db: DB, scope: TenantScope) {
  const showCost = can(scope, "view_food_cost");
  return withTenant(db, scope, async (tx) => {
    const k = await loadKitchen(tx);
    const usedIn = new Map<string, number>();
    for (const r of k.costRecipesMap.values()) for (const l of r.lines) if (l.ingredientId) usedIn.set(l.ingredientId, (usedIn.get(l.ingredientId) ?? 0) + 1);
    return {
      showCost,
      rows: k.ingRows.map((i) => {
        const p = k.priceOf.get(i.id);
        return {
          ...i,
          usedIn: usedIn.get(i.id) ?? 0,
          price: showCost && p ? { currency: p.currency, priceE4: p.priceE4, perMilli: p.perMilli, packLabel: p.packLabel, supplier: p.supplier, effectiveAt: p.effectiveAt, source: p.source } : null,
          hasPrice: Boolean(p),
        };
      }),
    };
  });
}

export function getIngredient(db: DB, scope: TenantScope, ingredientId: string) {
  const showCost = can(scope, "view_food_cost");
  return withTenant(db, scope, async (tx) => {
    const [i] = await tx.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    if (!i) return null;
    const prices = showCost
      ? await tx
          .select({ p: ingredientPrices, by: users.name })
          .from(ingredientPrices)
          .leftJoin(users, eq(users.id, ingredientPrices.createdBy))
          .where(eq(ingredientPrices.ingredientId, i.id))
          .orderBy(desc(ingredientPrices.effectiveAt), desc(ingredientPrices.createdAt))
      : [];
    const k = await loadKitchen(tx);
    const usedIn = k.recRows
      .filter((r) => k.costRecipesMap.get(r.id)!.lines.some((l) => l.ingredientId === i.id))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
    return { showCost, ingredient: i, prices: prices.map((x) => ({ ...x.p, by: x.by })), usedIn };
  });
}

/** Food Cost: every dish against the target, worst first, and the preps' cost per kg / L. */
export async function getFoodCost(db: DB, scope: TenantScope) {
  requirePermission(scope, "view_food_cost", "see food cost");
  return withTenant(db, scope, async (tx) => {
    const k = await loadKitchen(tx);
    const dishes = k.recRows
      .filter((r) => r.kind === "dish" && !r.archived)
      .map((r) => {
        const cost = k.costs.get(r.id)!;
        return { id: r.id, name: r.name, costMicros: cost.costMicros, complete: cost.complete, problems: cost.problems, warnings: cost.warnings, packagingE4: r.packagingE4, targetBp: r.targetBp ?? k.settings.targetBp, food: dishFoodCost(k, r, cost) };
      })
      .sort((a, b) => (b.food?.foodCostBp ?? -1) - (a.food?.foodCostBp ?? -1));
    const priced = dishes.filter((d) => d.food);
    const avgBp = priced.length ? Math.round(priced.reduce((s, d) => s + d.food!.foodCostBp, 0) / priced.length) : null;
    return {
      settings: k.settings,
      rateMissing: !k.rate,
      dishes,
      counts: {
        dishes: dishes.length,
        priced: priced.length,
        overTarget: priced.filter((d) => d.food!.overTarget).length,
        incomplete: dishes.filter((d) => !d.complete).length,
        noPrice: dishes.filter((d) => !d.food).length,
        ingredientsWithoutPrice: k.ingRows.filter((i) => !i.archived && !k.priceOf.has(i.id)).length,
        estimatedBatches: k.recRows.filter((r) => r.kind === "prep" && k.versionOf.get(r.id)?.yieldEstimated).length,
      },
      averageBp: avgBp,
    };
  });
}

// ---------------------------------------------------------------- writes: ingredients

export type IngredientInput = {
  id?: string;
  name: string;
  baseUnit: string;
  gramsPerMl?: string;
  gramsPerUnit?: string;
  yieldPct?: string;
  category?: string;
  supplier?: string;
  note?: string;
};

export async function saveIngredient(db: DB, scope: TenantScope, input: IngredientInput) {
  requireRecipes(scope);
  const name = cleanName(input.name);
  if (!name) throw new UserError("Give the ingredient a name.");
  if (name.length > 80) throw new UserError("Keep the name under 80 characters.");
  if (!(BASE_UNITS as string[]).includes(input.baseUnit)) throw new UserError("Choose how it's measured: grams, millilitres or pieces.");
  const values = {
    name,
    baseUnit: input.baseUnit as BaseUnit,
    gramsPerMlE4: decimal(input.gramsPerMl ?? "", 4, "weight per ml", { optional: true, min: 1n }),
    gramsPerUnitMilli: decimal(input.gramsPerUnit ?? "", 3, "weight of one piece", { optional: true, min: 1n }),
    yieldBp: percent(input.yieldPct ?? "", "usable yield", { optional: true, min: 100, max: 10000 }) ?? 10000,
    category: cleanName(input.category ?? "") || null,
    supplier: cleanName(input.supplier ?? "") || null,
    note: (input.note ?? "").trim() || null,
  };
  return withTenant(db, scope, async (tx) => {
    const same = (await tx.select({ id: ingredients.id, name: ingredients.name }).from(ingredients)).find((x) => keyOf(x.name) === keyOf(name) && x.id !== input.id);
    if (same) throw new UserError(`There's already an ingredient called ${same.name}.`);
    if (input.id) {
      const [row] = await tx.update(ingredients).set({ ...values, updatedAt: new Date() }).where(eq(ingredients.id, input.id)).returning({ id: ingredients.id });
      if (!row) throw new UserError("That ingredient doesn't exist.");
      return row.id;
    }
    const [row] = await tx.insert(ingredients).values({ ...values, orgId: scope.orgId, createdBy: scope.userId }).returning({ id: ingredients.id });
    return row.id;
  });
}

/** How a price is quoted, as the form offers it. */
export const PACKS: { value: string; label: string; perMilli: (base: BaseUnit, size: bigint | null) => bigint | null }[] = [
  { value: "kg", label: "per kg", perMilli: (b) => (b === "g" ? 1_000_000n : null) },
  { value: "L", label: "per litre", perMilli: (b) => (b === "ml" ? 1_000_000n : null) },
  { value: "piece", label: "per piece", perMilli: (b) => (b === "unit" ? 1000n : null) },
  { value: "pack", label: "per pack of…", perMilli: (_b, size) => size },
];

export async function setIngredientPrice(
  db: DB,
  scope: TenantScope,
  input: { ingredientId: string; price: string; currency: string; pack: string; packSize?: string; supplier?: string; note?: string },
) {
  requireRecipes(scope);
  const currency = input.currency === "LBP" ? "LBP" : input.currency === "USD" ? "USD" : null;
  if (!currency) throw new UserError("Pick a currency.");
  const priceE4 = decimal(input.price, currency === "USD" ? 4 : 0, "price", { min: 1n })! * (currency === "LBP" ? 10_000n : 1n);
  return withTenant(db, scope, async (tx) => {
    const [ing] = await tx.select().from(ingredients).where(eq(ingredients.id, input.ingredientId));
    if (!ing) throw new UserError("That ingredient doesn't exist.");
    const pack = PACKS.find((p) => p.value === input.pack);
    if (!pack) throw new UserError("Choose what the price is for.");
    const size = input.pack === "pack" ? decimal(input.packSize ?? "", 3, "pack size", { min: 1n }) : null;
    const perMilli = pack.perMilli(ing.baseUnit, size);
    if (!perMilli) throw new UserError(`${ing.name} is measured in ${ing.baseUnit === "unit" ? "pieces" : ing.baseUnit}; quote its price ${ing.baseUnit === "g" ? "per kg" : ing.baseUnit === "ml" ? "per litre" : "per piece"} or per pack.`);
    const unitWord = ing.baseUnit === "unit" ? "pieces" : ing.baseUnit;
    const packLabel = input.pack === "pack" ? `pack of ${parseDecimalLabel(size!)} ${unitWord}` : input.pack === "piece" ? "piece" : input.pack;
    const [row] = await tx
      .insert(ingredientPrices)
      .values({
        orgId: scope.orgId,
        ingredientId: ing.id,
        currency,
        priceE4,
        perMilli,
        packLabel,
        supplier: cleanName(input.supplier ?? "") || ing.supplier,
        source: "manual",
        note: (input.note ?? "").trim() || null,
        createdBy: scope.userId,
      })
      .returning({ id: ingredientPrices.id });
    return row.id;
  });
}

function parseDecimalLabel(milli: bigint) {
  const whole = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ---------------------------------------------------------------- writes: recipes

export type RecipeInput = {
  id?: string;
  name: string;
  kind: string;
  category?: string;
  sellingPrice?: string;
  priceCurrency?: string;
  packaging?: string;
  targetPct?: string;
  yieldQty?: string;
  yieldUnit?: string;
  note?: string;
  lines: { ref: string; quantity: string; unit: string }[];
};

/**
 * Creates a recipe or changes one. A change to its ingredients or batch size
 * is saved as a new version; earlier versions are kept as they were.
 */
export async function saveRecipe(db: DB, scope: TenantScope, input: RecipeInput) {
  requireRecipes(scope);
  const name = cleanName(input.name);
  if (!name) throw new UserError("Give the recipe a name.");
  if (input.kind !== "dish" && input.kind !== "prep") throw new UserError("Choose whether it's a dish or a prep.");
  const kind: "dish" | "prep" = input.kind === "prep" ? "prep" : "dish";
  const currency: Currency = input.priceCurrency === "LBP" ? "LBP" : "USD";
  const priceRaw = (input.sellingPrice ?? "").trim();
  const sellingPriceE4 = kind === "dish" && priceRaw ? decimal(priceRaw, currency === "USD" ? 4 : 0, "selling price", { min: 1n })! * (currency === "LBP" ? 10_000n : 1n) : null;
  const packagingE4 = decimal(input.packaging ?? "", 4, "packaging cost", { optional: true }) ?? 0n;
  const targetBp = percent(input.targetPct ?? "", "target food cost", { optional: true, min: 100, max: 9000 });
  let yieldMilli: bigint | null = null;
  let yieldUnit: BaseUnit | null = null;
  if (kind === "prep") {
    yieldMilli = decimal(input.yieldQty ?? "", 3, "batch size", { min: 1n });
    if (!(BASE_UNITS as string[]).includes(input.yieldUnit ?? "")) throw new UserError("Choose the batch size's unit.");
    yieldUnit = input.yieldUnit as BaseUnit;
  }
  const lines = input.lines
    .filter((l) => l.ref && l.quantity.trim())
    .map((l, i) => {
      if (!(LINE_UNITS as string[]).includes(l.unit)) throw new UserError(`Line ${i + 1}: choose a unit.`);
      const [type, id] = l.ref.split(":");
      if ((type !== "i" && type !== "r") || !id) throw new UserError(`Line ${i + 1}: choose an ingredient or prep.`);
      return {
        ingredientId: type === "i" ? id : null,
        subRecipeId: type === "r" ? id : null,
        quantityMilli: decimal(l.quantity, 3, `quantity on line ${i + 1}`)!,
        unit: l.unit as RecipeUnit,
      };
    });
  if (lines.length === 0) throw new UserError("Add at least one ingredient.");
  if (input.id && lines.some((l) => l.subRecipeId === input.id)) throw new UserError("A recipe can't use itself.");

  return withTenant(db, scope, async (tx) => {
    const all = await tx.select({ id: recipes.id, name: recipes.name }).from(recipes);
    const clash = all.find((x) => keyOf(x.name) === keyOf(name) && x.id !== input.id);
    if (clash) throw new UserError(`There's already a recipe called ${clash.name}.`);
    const fields = {
      name,
      kind,
      category: cleanName(input.category ?? "") || null,
      priceCurrency: sellingPriceE4 ? currency : null,
      sellingPriceE4,
      packagingE4,
      targetBp,
    };
    let id = input.id;
    if (id) {
      const [row] = await tx.update(recipes).set({ ...fields, updatedAt: new Date() }).where(eq(recipes.id, id)).returning({ id: recipes.id });
      if (!row) throw new UserError("That recipe doesn't exist.");
    } else {
      const [row] = await tx.insert(recipes).values({ ...fields, orgId: scope.orgId, createdBy: scope.userId }).returning({ id: recipes.id });
      id = row.id;
    }
    await writeVersion(tx, scope, id!, { yieldMilli, yieldUnit, yieldEstimated: false, lines, note: (input.note ?? "").trim() || null });
    // A prep that would end up using itself through another prep is refused.
    const k = await loadKitchen(tx);
    const looped = k.costs.get(id!)!.problems.find((p) => / again$/.test(p));
    if (looped) throw new UserError(`That would make a loop: ${looped}.`);
    return id!;
  });
}

type VersionInput = {
  yieldMilli: bigint | null;
  yieldUnit: BaseUnit | null;
  yieldEstimated: boolean;
  lines: { ingredientId: string | null; subRecipeId: string | null; quantityMilli: bigint; unit: RecipeUnit }[];
  note: string | null;
};

/** Writes a new version only when the lines or batch size differ from the latest one. */
async function writeVersion(tx: Tx, scope: TenantScope, recipeId: string, v: VersionInput): Promise<boolean> {
  const [latest] = await tx.select().from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId)).orderBy(desc(recipeVersions.version)).limit(1);
  if (latest) {
    const old = await tx.select().from(recipeLines).where(eq(recipeLines.versionId, latest.id)).orderBy(asc(recipeLines.position));
    const same =
      latest.yieldMilli === v.yieldMilli &&
      latest.yieldUnit === v.yieldUnit &&
      latest.yieldEstimated === v.yieldEstimated &&
      old.length === v.lines.length &&
      old.every((o, i) => o.ingredientId === v.lines[i].ingredientId && o.subRecipeId === v.lines[i].subRecipeId && o.quantityMilli === v.lines[i].quantityMilli && o.unit === v.lines[i].unit);
    if (same) return false;
  }
  const [version] = await tx
    .insert(recipeVersions)
    .values({
      orgId: scope.orgId,
      recipeId,
      version: (latest?.version ?? 0) + 1,
      yieldMilli: v.yieldMilli,
      yieldUnit: v.yieldUnit,
      yieldEstimated: v.yieldEstimated,
      note: v.note,
      createdBy: scope.userId,
    })
    .returning({ id: recipeVersions.id });
  if (v.lines.length) {
    await tx.insert(recipeLines).values(v.lines.map((l, i) => ({ orgId: scope.orgId, versionId: version.id, position: i + 1, ...l })));
  }
  return true;
}

export async function setRecipeArchived(db: DB, scope: TenantScope, recipeId: string, archived: boolean) {
  requireRecipes(scope);
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx.update(recipes).set({ archived, updatedAt: new Date() }).where(eq(recipes.id, recipeId)).returning({ id: recipes.id });
    if (!row) throw new UserError("That recipe doesn't exist.");
  });
}

export async function updateFoodCostSettings(db: DB, scope: TenantScope, input: { target: string; overhead: string; vat: string; vatIncluded: boolean }) {
  if (scope.role !== "owner") throw new UserError("Only owners change the food cost settings.");
  const targetBp = percent(input.target, "target food cost", { min: 100, max: 9000 })!;
  const overheadBp = percent(input.overhead, "overhead", { optional: true, min: 0, max: 10000 }) ?? 0;
  const vatBp = input.vatIncluded ? percent(input.vat, "VAT rate", { min: 0, max: 5000 }) : null;
  return withTenant(db, scope, async (tx) => {
    await tx.update(organizations).set({ foodCostTargetBp: targetBp, overheadBp, menuVatBp: vatBp }).where(eq(organizations.id, scope.orgId));
  });
}

// ---------------------------------------------------------------- importing a workbook

async function readSheets(fileName: string, bytes: Uint8Array): Promise<Sheet[]> {
  if (bytes.byteLength === 0) throw new UserError("That file is empty.");
  if (bytes.byteLength > MAX_BYTES) throw new UserError("Workbooks can be up to 5 MB.");
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw new UserError("Upload the costing workbook as an Excel file (.xlsx). From Google Sheets: File → Download → Microsoft Excel.");
  const { default: readXlsxFile } = await import("read-excel-file/node");
  try {
    const sheets = await readXlsxFile(Buffer.from(bytes), { parseNumber: (s: string) => s });
    return sheets.map((s) => ({
      name: s.sheet,
      rows: s.data.map((row) => row.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)))),
    }));
  } catch {
    throw new UserError("Couldn't read that workbook. Save it again as .xlsx and upload it.");
  }
}

export async function createRecipeImport(db: DB, scope: TenantScope, input: { fileName: string; bytes: Uint8Array }) {
  requireRecipes(scope);
  const sheets = await readSheets(input.fileName, input.bytes);
  let plan: Plan;
  try {
    plan = planToJson(readWorkbook(sheets));
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : "Couldn't read that workbook.");
  }
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx
      .insert(recipeImports)
      .values({ orgId: scope.orgId, fileName: input.fileName.slice(0, 200), fileHash, plan, createdBy: scope.userId })
      .returning({ id: recipeImports.id });
    return row.id;
  });
}

const samePrice = (a: Price | null | undefined, b: { currency: Currency; priceE4: bigint; perMilli: bigint } | undefined) =>
  Boolean(a && b && a.currency === b.currency && BigInt(a.priceE4) === b.priceE4 && BigInt(a.perMilli) === b.perMilli);

/** What posting the plan would change, against what's already saved. */
function diffPlan(plan: Plan, k: Kitchen) {
  const ingByKey = new Map(k.ingRows.map((i) => [keyOf(i.name), i]));
  const recByKey = new Map(k.recRows.map((r) => [keyOf(r.name), r]));
  const ing = { added: 0, repriced: 0, unchanged: 0, unitClash: [] as string[] };
  for (const i of plan.ingredients) {
    const cur = ingByKey.get(i.key);
    if (!cur) ing.added++;
    else if (cur.baseUnit !== i.baseUnit) ing.unitClash.push(i.name);
    else if (i.price && !samePrice(i.price, k.priceOf.get(cur.id))) ing.repriced++;
    else ing.unchanged++;
  }
  const rec = { added: 0, changed: [] as string[], unchanged: 0 };
  const ingName = new Map(k.ingRows.map((i) => [i.id, keyOf(i.name)]));
  const recName = new Map(k.recRows.map((r) => [r.id, keyOf(r.name)]));
  for (const r of plan.recipes) {
    const cur = recByKey.get(r.key);
    if (!cur) {
      rec.added++;
      continue;
    }
    const now = k.costRecipesMap.get(cur.id)!;
    const v = k.versionOf.get(cur.id);
    const sameLines =
      now.lines.length === r.lines.length &&
      now.lines.every((l, i) => {
        const p = r.lines[i];
        const ref = l.ingredientId ? { type: "ingredient", key: ingName.get(l.ingredientId) } : { type: "prep", key: recName.get(l.subRecipeId!) };
        return ref.type === p.ref.type && ref.key === p.ref.key && l.quantityMilli === BigInt(p.quantityMilli) && l.unit === p.unit;
      });
    const sameYield = (v?.yieldMilli ?? null) === (r.yieldMilli ? BigInt(r.yieldMilli) : null) && (v?.yieldUnit ?? null) === r.yieldUnit;
    const sameHead = cur.kind === r.kind && cur.sellingPriceE4 === (r.sellingPriceE4 ? BigInt(r.sellingPriceE4) : null) && cur.packagingE4 === BigInt(r.packagingE4);
    if (sameLines && sameYield && sameHead) rec.unchanged++;
    else rec.changed.push(cur.name);
  }
  return { ingredients: ing, recipes: rec };
}

export function getRecipeImport(db: DB, scope: TenantScope, importId: string) {
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(recipeImports).where(eq(recipeImports.id, importId));
    if (!imp) return null;
    const plan = imp.plan as Plan;
    const k = await loadKitchen(tx);
    const costs = planCosts(plan);
    const settings: FoodCostSettings = {
      targetBp: plan.settings.targetBp ?? k.settings.targetBp,
      overheadBp: plan.settings.overheadBp ?? k.settings.overheadBp,
      vatBp: k.settings.vatBp,
    };
    const dishes = plan.recipes
      .map((r) => {
        const c = costs.get(`r:${r.key}`)!;
        const food = r.kind === "dish" && r.sellingPriceE4 ? foodCost(c.costMicros, BigInt(r.packagingE4), BigInt(r.sellingPriceE4) * 100n, { ...settings, targetBp: r.targetBp ?? settings.targetBp }) : null;
        return { name: r.name, kind: r.kind, lines: r.lines.length, costMicros: c.costMicros, complete: c.complete, problems: c.problems, food, yieldEstimated: r.yieldEstimated };
      })
      .sort((a, b) => (b.food?.foodCostBp ?? -1) - (a.food?.foodCostBp ?? -1));
    // One entry per ingredient that stops dishes being costed, with how many recipes it affects.
    const toFix = new Map<string, { name: string; problem: string; recipes: Set<string> }>();
    for (const r of plan.recipes) {
      for (const l of costs.get(`r:${r.key}`)!.lines) {
        if (!l.problem || l.kind !== "ingredient") continue;
        const e = toFix.get(l.name) ?? { name: l.name, problem: l.problem, recipes: new Set<string>() };
        e.recipes.add(r.name);
        toFix.set(l.name, e);
      }
    }
    return {
      ingredientsToFix: [...toFix.values()].map((e) => ({ name: e.name, problem: e.problem, recipes: [...e.recipes] })).sort((a, b) => b.recipes.length - a.recipes.length),
      import: { ...imp, plan: undefined },
      plan,
      dishes,
      settings,
      diff: diffPlan(plan, k),
      canPost: can(scope, "manage_recipes"),
      isOwner: scope.role === "owner",
    };
  });
}

/**
 * Saves a checked plan in one transaction: new ingredients and recipes,
 * a new price where it differs from the current one, a new recipe version
 * where the lines differ, and (owners only) the business's target and
 * overhead. Posting the same workbook again changes nothing.
 */
export async function postRecipeImport(db: DB, scope: TenantScope, importId: string) {
  requireRecipes(scope);
  return withTenant(db, scope, async (tx) => {
    const [imp] = await tx.select().from(recipeImports).where(eq(recipeImports.id, importId)).for("update");
    if (!imp) throw new UserError("That import doesn't exist.");
    if (imp.status !== "draft") throw new UserError(`This workbook was already ${imp.status}.`);
    const plan = imp.plan as Plan;
    const k = await loadKitchen(tx);
    const ingByKey = new Map(k.ingRows.map((i) => [keyOf(i.name), i]));
    const recByKey = new Map(k.recRows.map((r) => [keyOf(r.name), r]));
    const summary = { ingredientsAdded: 0, pricesAdded: 0, recipesAdded: 0, recipesUpdated: 0, versionsAdded: 0, unitClashes: [] as string[], settings: false };

    const ingId = new Map<string, string>();
    for (const i of plan.ingredients) {
      let cur = ingByKey.get(i.key);
      if (!cur) {
        [cur] = await tx
          .insert(ingredients)
          .values({ orgId: scope.orgId, name: i.name, baseUnit: i.baseUnit, supplier: i.supplier, category: i.category, createdBy: scope.userId })
          .returning();
        summary.ingredientsAdded++;
      }
      ingId.set(i.key, cur.id);
      if (cur.baseUnit !== i.baseUnit) {
        summary.unitClashes.push(i.name);
        continue;
      }
      if (i.price && !samePrice(i.price, k.priceOf.get(cur.id))) {
        await tx.insert(ingredientPrices).values({
          orgId: scope.orgId,
          ingredientId: cur.id,
          currency: i.price.currency,
          priceE4: BigInt(i.price.priceE4),
          perMilli: BigInt(i.price.perMilli),
          packLabel: i.price.packLabel,
          supplier: i.supplier,
          source: "import",
          note: `From ${imp.fileName}`,
          createdBy: scope.userId,
        });
        summary.pricesAdded++;
      }
    }

    const recId = new Map<string, string>();
    for (const r of plan.recipes) {
      const fields = {
        name: r.name,
        kind: r.kind,
        priceCurrency: r.sellingPriceE4 ? ("USD" as const) : null,
        sellingPriceE4: r.sellingPriceE4 ? BigInt(r.sellingPriceE4) : null,
        packagingE4: BigInt(r.packagingE4),
        targetBp: r.targetBp,
      };
      const cur = recByKey.get(r.key);
      if (cur) {
        const differs =
          cur.kind !== fields.kind || cur.sellingPriceE4 !== fields.sellingPriceE4 || cur.packagingE4 !== fields.packagingE4 || cur.targetBp !== fields.targetBp;
        if (differs) {
          await tx.update(recipes).set({ ...fields, name: cur.name, updatedAt: new Date() }).where(eq(recipes.id, cur.id));
          summary.recipesUpdated++;
        }
        recId.set(r.key, cur.id);
      } else {
        const [row] = await tx.insert(recipes).values({ ...fields, orgId: scope.orgId, createdBy: scope.userId }).returning({ id: recipes.id });
        recId.set(r.key, row.id);
        summary.recipesAdded++;
      }
    }

    for (const r of plan.recipes) {
      const wrote = await writeVersion(tx, scope, recId.get(r.key)!, {
        yieldMilli: r.yieldMilli ? BigInt(r.yieldMilli) : null,
        yieldUnit: r.yieldUnit,
        yieldEstimated: r.yieldEstimated,
        note: `From ${imp.fileName}`,
        lines: r.lines.map((l) => ({
          ingredientId: l.ref.type === "ingredient" ? ingId.get(l.ref.key)! : null,
          subRecipeId: l.ref.type === "prep" ? recId.get(l.ref.key)! : null,
          quantityMilli: BigInt(l.quantityMilli),
          unit: l.unit,
        })),
      });
      if (wrote) summary.versionsAdded++;
    }

    if (scope.role === "owner" && (plan.settings.targetBp != null || plan.settings.overheadBp != null)) {
      await tx
        .update(organizations)
        .set({
          ...(plan.settings.targetBp != null ? { foodCostTargetBp: plan.settings.targetBp } : {}),
          ...(plan.settings.overheadBp != null ? { overheadBp: plan.settings.overheadBp } : {}),
        })
        .where(eq(organizations.id, scope.orgId));
      summary.settings = true;
    }

    await tx.update(recipeImports).set({ status: "posted", summary, postedBy: scope.userId, postedAt: new Date() }).where(eq(recipeImports.id, imp.id));
    return summary;
  });
}

export async function discardRecipeImport(db: DB, scope: TenantScope, importId: string) {
  requireRecipes(scope);
  return withTenant(db, scope, async (tx) => {
    const [row] = await tx.update(recipeImports).set({ status: "discarded" }).where(and(eq(recipeImports.id, importId), eq(recipeImports.status, "draft"))).returning({ id: recipeImports.id });
    if (!row) throw new UserError("Only a workbook that hasn't been posted can be discarded.");
  });
}

export function listRecipeImports(db: DB, scope: TenantScope) {
  return withTenant(db, scope, (tx) =>
    tx
      .select({ id: recipeImports.id, fileName: recipeImports.fileName, status: recipeImports.status, createdAt: recipeImports.createdAt, postedAt: recipeImports.postedAt, by: users.name })
      .from(recipeImports)
      .leftJoin(users, eq(users.id, recipeImports.createdBy))
      .orderBy(desc(recipeImports.createdAt))
      .limit(20),
  );
}
