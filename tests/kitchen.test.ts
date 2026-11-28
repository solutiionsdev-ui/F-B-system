// Kitchen, stage A, through the database: importing a costing workbook
// (preview, then post once), recipes saved as versions, prices kept as
// history, food cost permissions, and the database's own guards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { loadScope, migrate, openPglite, type Database, type TenantScope } from "@/db/database";
import { CEDAR_NAME, ensureCedarDemo } from "@/db/demo-cedar";
import { auditLog, ingredientPrices, ingredients, organizations, recipeVersions, recipes, users } from "@/db/schema";
import { UserError } from "@/server/operations";
import {
  createRecipeImport,
  discardRecipeImport,
  getFoodCost,
  getIngredient,
  getRecipe,
  getRecipeImport,
  listRecipes,
  postRecipeImport,
  saveRecipe,
  setIngredientPrice,
} from "@/server/kitchen";
import { writeXlsx } from "@/lib/xlsx-writer";
import { filledTemplate, SAMPLE_WORKBOOK, workbookXlsx } from "./workbook-fixture";

let database: Database;
let owner: TenantScope;
let manager: TenantScope;
let accountant: TenantScope;

beforeAll(async () => {
  database = await openPglite();
  await migrate(database);
  await ensureCedarDemo(database, "2026-11-26");
  const db = database.db;
  const [org] = await db.select().from(organizations).where(eq(organizations.name, CEDAR_NAME));
  const scopeOf = async (email: string) => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    return (await loadScope(db, u.id, org.id))!;
  };
  owner = await scopeOf("owner@demo.test");
  manager = await scopeOf("manager@demo.test");
  accountant = await scopeOf("accountant@demo.test");
}, 120_000);

afterAll(async () => {
  await database?.close();
});

const file = (sheets = SAMPLE_WORKBOOK) => ({ fileName: "menu-costs.xlsx", bytes: workbookXlsx(sheets) });
const recipeByName = async (name: string) => (await database.db.select().from(recipes).where(and(eq(recipes.orgId, owner.orgId), eq(recipes.name, name))))[0];

describe("importing a costing workbook", () => {
  let importId = "";

  it("reads the .xlsx into a draft and shows every dish's cost and every issue before saving anything", async () => {
    importId = await createRecipeImport(database.db, owner, file());
    const preview = (await getRecipeImport(database.db, owner, importId))!;
    expect(preview.import.status).toBe("draft");
    expect(preview.diff.ingredients.added).toBe(preview.plan.ingredients.length);
    expect(preview.diff.recipes.added).toBe(5);
    const toast = preview.dishes.find((d) => d.name === "Cheese toast")!;
    expect(toast).toMatchObject({ complete: false, problems: ["chives has no price"] });
    expect(toast.food!.foodCostBp).toBe(1388); // $1.110505 on $8
    expect(preview.plan.issues.some((i) => i.subject === "House dressing" && /estimated at 152 g/.test(i.message))).toBe(true);
    // Nothing saved yet.
    expect(await database.db.select().from(recipes).where(eq(recipes.orgId, owner.orgId))).toHaveLength(0);
  });

  it("posts once: ingredients, prices, recipes, a first version each, and the owner's target and overhead", async () => {
    const summary = await postRecipeImport(database.db, owner, importId);
    expect(summary).toMatchObject({ recipesAdded: 5, versionsAdded: 5, settings: true });
    expect(summary.ingredientsAdded).toBe(11);
    expect(summary.pricesAdded).toBe(9); // flour and chives have no price
    const [org] = await database.db.select().from(organizations).where(eq(organizations.id, owner.orgId));
    expect(org).toMatchObject({ foodCostTargetBp: 3000, overheadBp: 2200 });
    await expect(postRecipeImport(database.db, owner, importId)).rejects.toThrow(/already posted/);
    // The audit trail records the import without storing the workbook again.
    const [a] = await database.db.select().from(auditLog).where(and(eq(auditLog.tableName, "recipe_imports"), eq(auditLog.op, "INSERT")));
    expect(a.newData).not.toHaveProperty("plan");
  });

  it("changes nothing when the same workbook is posted again", async () => {
    const again = await createRecipeImport(database.db, owner, file());
    const preview = (await getRecipeImport(database.db, owner, again))!;
    expect(preview.diff.recipes).toMatchObject({ added: 0, changed: [] });
    expect(preview.diff.ingredients).toMatchObject({ added: 0, repriced: 0 });
    const summary = await postRecipeImport(database.db, owner, again);
    expect(summary).toMatchObject({ ingredientsAdded: 0, pricesAdded: 0, recipesAdded: 0, versionsAdded: 0 });
  });

  it("keeps price history: a new price in the workbook adds a row and every dish follows", async () => {
    const before = (await listRecipes(database.db, owner)).rows.find((r) => r.name === "Cheese toast")!;
    const dearer = SAMPLE_WORKBOOK.map((s) => (s.name === "PriceList" ? { ...s, rows: s.rows.map((r) => (r[0] === " white cheese" ? [r[0], r[1], "30", r[3]] : r)) } : s));
    const id = await createRecipeImport(database.db, owner, file(dearer));
    expect((await getRecipeImport(database.db, owner, id))!.diff.ingredients.repriced).toBe(1);
    await postRecipeImport(database.db, owner, id);
    const cheese = (await database.db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId))).find((i) => i.name === "white cheese")!;
    const history = await database.db.select().from(ingredientPrices).where(eq(ingredientPrices.ingredientId, cheese.id));
    expect(history.map((h) => h.priceE4).sort()).toEqual([266_700n, 300_000n]);
    const after = (await listRecipes(database.db, owner)).rows.find((r) => r.name === "Cheese toast")!;
    expect(after.costMicros! - before.costMicros!).toBe(66_600n); // 20 g × $3.33/kg more
    expect(after.version).toBe(before.version); // the recipe itself didn't change
  });

  it("lets a draft be discarded, and only by someone who may change recipes", async () => {
    const id = await createRecipeImport(database.db, owner, file());
    await expect(discardRecipeImport(database.db, manager, id)).rejects.toThrow(UserError);
    await discardRecipeImport(database.db, owner, id);
    await expect(postRecipeImport(database.db, owner, id)).rejects.toThrow(/already discarded/);
    await expect(createRecipeImport(database.db, manager, file())).rejects.toThrow(UserError);
    await expect(createRecipeImport(database.db, owner, { fileName: "costs.csv", bytes: new Uint8Array([1]) })).rejects.toThrow(/\.xlsx/);
  });
});

describe("recipes", () => {
  it("saves a change as a new version and keeps the old one", async () => {
    const toast = await recipeByName("Cheese toast");
    const r = (await getRecipe(database.db, owner, toast.id))!;
    const lines = r.lines.map((l) => ({
      ref: l.line.ingredientId ? `i:${l.line.ingredientId}` : `r:${l.line.subRecipeId}`,
      quantity: (Number(l.line.quantityMilli) / 1000).toString(),
      unit: l.line.unit,
    }));
    const base = { id: toast.id, name: "Cheese toast", kind: "dish", sellingPrice: "8", priceCurrency: "USD", lines };
    await saveRecipe(database.db, owner, base); // nothing changed
    expect(await database.db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, toast.id))).toHaveLength(1);
    await saveRecipe(database.db, owner, { ...base, lines: lines.map((l, i) => (i === 1 ? { ...l, quantity: "25" } : l)), note: "More cheese" });
    const versions = await database.db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, toast.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    const now = (await getRecipe(database.db, owner, toast.id))!;
    expect(now.history.map((h) => h.version)).toEqual([2, 1]);
    expect(now.lines[1].line.quantityMilli).toBe(25_000n);
  });

  it("refuses a loop between preps, a prep without a batch size, and a duplicate name", async () => {
    const dressing = await recipeByName("House dressing");
    const salt = (await database.db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId))).find((i) => i.name === "salt")!;
    const vinaigrette = await saveRecipe(database.db, owner, {
      name: "Vinaigrette",
      kind: "prep",
      yieldQty: "100",
      yieldUnit: "g",
      lines: [{ ref: `r:${dressing.id}`, quantity: "50", unit: "g" }],
    });
    await expect(
      saveRecipe(database.db, owner, { id: dressing.id, name: "House dressing", kind: "prep", yieldQty: "152", yieldUnit: "g", lines: [{ ref: `r:${vinaigrette}`, quantity: "10", unit: "g" }] }),
    ).rejects.toThrow(/loop/);
    await expect(saveRecipe(database.db, owner, { name: "Brine", kind: "prep", lines: [{ ref: `i:${salt.id}`, quantity: "5", unit: "g" }] })).rejects.toThrow(/batch size/);
    await expect(saveRecipe(database.db, owner, { name: "cheese TOAST ", kind: "dish", lines: [{ ref: `i:${salt.id}`, quantity: "1", unit: "g" }] })).rejects.toThrow(/already a recipe/);
  });

  it("keeps recipes with whoever may change them", async () => {
    const salt = (await database.db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId))).find((i) => i.name === "salt")!;
    await expect(saveRecipe(database.db, manager, { name: "Fries", kind: "dish", lines: [{ ref: `i:${salt.id}`, quantity: "1", unit: "g" }] })).rejects.toThrow(UserError);
  });
});

describe("prices and food cost", () => {
  it("adds a price as history in the ingredient's own unit, and refuses one in the wrong unit", async () => {
    const lemon = (await database.db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId))).find((i) => i.name === "lemon")!;
    await expect(setIngredientPrice(database.db, owner, { ingredientId: lemon.id, price: "2", currency: "USD", pack: "L" })).rejects.toThrow(/per kg/);
    await setIngredientPrice(database.db, owner, { ingredientId: lemon.id, price: "180,000", currency: "LBP", pack: "kg", supplier: "Market" });
    const detail = (await getIngredient(database.db, owner, lemon.id))!;
    expect(detail.prices).toHaveLength(2);
    expect(detail.prices[0]).toMatchObject({ currency: "LBP", priceE4: 1_800_000_000n, source: "manual", supplier: "Market" });
    expect(detail.usedIn.map((u) => u.name)).toEqual(["House dressing"]);
  });

  it("never lets a price be edited or deleted", async () => {
    const reason = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
    expect(reason(await database.db.execute(sql`update ingredient_prices set price_e4 = 1`).catch((e) => e))).toMatch(/append-only/);
    expect(reason(await database.db.execute(sql`delete from recipe_lines`).catch((e) => e))).toMatch(/append-only/);
  });

  it("shows food cost to owners and accountants, worst first, and not to managers by default", async () => {
    const fc = await getFoodCost(database.db, owner);
    expect(fc.settings).toMatchObject({ targetBp: 3000, overheadBp: 2200 });
    expect(fc.dishes.map((d) => d.food?.foodCostBp ?? -1)).toEqual([...fc.dishes.map((d) => d.food?.foodCostBp ?? -1)].sort((a, b) => b - a));
    expect(fc.counts.incomplete).toBeGreaterThan(0);
    expect(fc.counts.estimatedBatches).toBe(1);
    await expect(getFoodCost(database.db, accountant)).resolves.toBeTruthy();
    await expect(getFoodCost(database.db, manager)).rejects.toThrow(UserError);
    const forManager = await listRecipes(database.db, manager);
    expect(forManager.rows.length).toBeGreaterThan(0); // the kitchen sees the recipes
    expect(forManager.rows.every((r) => r.costMicros === null && r.food === null)).toBe(true); // but not their cost
  });
});

describe("importing the filled-in template", () => {
  it("saves usable %, weights and exact batch sizes, and updates them on a later import", async () => {
    const db = database.db;
    const id = await createRecipeImport(db, owner, { fileName: "finctrl-recipes-template.xlsx", bytes: writeXlsx(filledTemplate()) });
    await postRecipeImport(db, owner, id);
    const all = await db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId));
    expect(all.find((i) => i.name === "Tomato")!.yieldBp).toBe(9000);
    expect(all.find((i) => i.name === "Egg")!.gramsPerUnitMilli).toBe(60_000n);
    expect(all.find((i) => i.name.toLowerCase() === "olive oil")!.gramsPerMlE4).toBe(9100n);
    const sauce = await recipeByName("Garlic sauce");
    const [v] = await db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, sauce.id));
    expect(v).toMatchObject({ yieldMilli: 400_000n, yieldUnit: "g", yieldEstimated: false });

    // The tomatoes turn out better: usable 95%.
    const better = filledTemplate().map((s) => (s.name === "PriceList" ? { ...s, rows: s.rows.map((r) => (r[0] === "Tomato" ? [r[0], r[1], r[2], r[3], 95, r[5], r[6]] : r)) } : s));
    const again = await createRecipeImport(db, owner, { fileName: "finctrl-recipes-template.xlsx", bytes: writeXlsx(better) });
    expect((await getRecipeImport(db, owner, again))!.diff.ingredients.detailed).toBe(1);
    const summary = await postRecipeImport(db, owner, again);
    expect(summary.ingredientsUpdated).toBe(1);
    const tomato = (await db.select().from(ingredients).where(eq(ingredients.orgId, owner.orgId))).find((i) => i.name === "Tomato")!;
    expect(tomato.yieldBp).toBe(9500);
  });
});
