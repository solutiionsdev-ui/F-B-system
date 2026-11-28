// The Excel template a restaurant fills in to bring its prices and recipes
// into FINCTRL in one go, instead of typing them in. Same three sheets the
// importer reads (lib/menu-workbook.ts), with the optional columns that make a
// dish fully costed on the first import. The example rows show how to fill
// it; anything named "Example…" is skipped on import.
import type { WriteSheet } from "./xlsx-writer";

export const RECIPE_TEMPLATE_FILE = "finctrl-recipes-template.xlsx";
export const PRICES_TEMPLATE_FILE = "finctrl-prices-template.xlsx";

export const TEMPLATE_HEADERS = {
  prices: ["Ingredient", "Pricing Unit (kg/l/unit)", "Price per Unit", "Notes (supplier)", "Usable %", "Weight of 1 piece (g)", "Weight of 1 ml (g)"],
  recipes: ["Menu Item", "Ingredient", "Qty", "Qty Unit (g/kg/ml/l/unit)"],
  menu: ["Menu Item", "Selling prices", "Packaging Cost", "Target Food Cost %", "Overhead %", "Batch size (preps)", "Batch unit (g/ml/unit)"],
};

/** The price list sheet, shared by both templates. */
function priceListSheet(): WriteSheet {
  return {
    name: "PriceList",
    widths: [32, 24, 16, 22, 12, 22, 20],
    rows: [
      TEMPLATE_HEADERS.prices,
      ["Example – Halloumi", "kg", 12.5, "Dairy supplier", "", "", ""],
      ["Example – Sourdough bread", "unit", 0.41, "Bakery", "", "", ""],
      ["Example – Tomato", "kg", 1.8, "Market", 90, "", ""],
      ["Example – Olive oil", "L", 8.9, "", "", "", 0.91],
      ["Example – Garlic", "kg", 4, "Market", 85, "", ""],
      ["Example – Lemon", "kg", 1.5, "Market", 45, "", ""],
      ["Example – Egg", "unit", 0.23, "", "", 60, ""],
      ["Example – Basil", "unit (30g)", 0.4, "Market", "", "", ""],
    ],
  };
}

export function recipeTemplate(): WriteSheet[] {
  return [
    {
      name: "How to fill",
      widths: [110],
      rows: [
        ["FINCTRL: import your prices and recipes"],
        ["Fill in the three sheets, save as .xlsx, then upload it in FINCTRL: Kitchen → Recipes → Import costing workbook."],
        ["You see every dish's cost and every problem before anything is saved. Importing again later only adds what changed."],
        [""],
        ["1. PriceList: one row per ingredient you buy."],
        ['   Pricing unit: kg, L or unit (a piece), or a pack such as "unit (30g)" for a 30 g bunch. Price in US dollars for that unit.'],
        ["   Usable %: what's left after trimming, peeling or bones (avocado about 70). Leave blank for 100."],
        ["   Weight of 1 piece (g): for things bought by the piece but used by weight, or the other way round (an egg about 60)."],
        ["   Weight of 1 ml (g): for liquids bought by the litre but weighed in recipes (oil about 0.91, water 1)."],
        ["2. Recipes: one row per ingredient line, for every dish and every prep (sauces, marinades, bases)."],
        ["   Quantity as it goes on the plate. Units: g, kg, ml, l or unit."],
        ["   To use a sauce in a dish, give the sauce its own recipe and write its name as the ingredient."],
        ["3. MenuCosts: one row per dish with its menu price, and one row per prep with its batch size."],
        ["   Batch size: what one batch of the prep makes (weigh it), with its unit. This is what each portion is costed from."],
        ["   Target food cost % and overhead %: the most common value becomes the business's; a dish with a different target keeps its own."],
        ["4. Rows whose name starts with \"Example\" show how to fill the sheets and are skipped. Delete them or leave them."],
      ],
      header: true,
    },
    priceListSheet(),
    {
      name: "Recipes",
      widths: [30, 30, 10, 26],
      rows: [
        TEMPLATE_HEADERS.recipes,
        ["Example – Halloumi toast", "Example – Sourdough bread", 1, "unit"],
        ["Example – Halloumi toast", "Example – Halloumi", 60, "g"],
        ["Example – Halloumi toast", "Example – Tomato", 40, "g"],
        ["Example – Halloumi toast", "Example – Garlic sauce", 20, "g"],
        ["Example – Halloumi toast", "Example – Basil", 3, "g"],
        ["Example – Garlic sauce", "Example – Garlic", 80, "g"],
        ["Example – Garlic sauce", "Example – Olive oil", 300, "ml"],
        ["Example – Garlic sauce", "Example – Lemon", 60, "g"],
      ],
    },
    {
      name: "MenuCosts",
      widths: [30, 16, 16, 20, 12, 20, 22],
      rows: [
        TEMPLATE_HEADERS.menu,
        ["Example – Halloumi toast", 9, 0.6, 30, 22, "", ""],
        ["Example – Garlic sauce", "", "", "", "", 400, "g"],
      ],
    },
  ];
}

/** Just the price list: for updating ingredient prices (Kitchen › Inventory) without touching recipes. */
export function pricesTemplate(): WriteSheet[] {
  return [
    {
      name: "How to fill",
      widths: [110],
      rows: [
        ["FINCTRL: import ingredient prices"],
        ["Fill in the PriceList sheet, save as .xlsx, then upload it in FINCTRL: Kitchen → Inventory → Import prices from Excel."],
        ["You see what changes before anything is saved. Recipes are not touched."],
        [""],
        ["One row per ingredient you buy. A name that's already in FINCTRL updates that ingredient; a new name adds one."],
        ['Pricing unit: kg, L or unit (a piece), or a pack such as "unit (30g)" for a 30 g bunch. Price in US dollars for that unit.'],
        ["A changed price is added to the ingredient's price history with today's date; earlier prices are kept, and every recipe using it is recosted."],
        ["An ingredient must keep the same kind of unit (weight, volume or pieces) as in FINCTRL; otherwise its price is left alone."],
        ["Usable %: what's left after trimming, peeling or bones (avocado about 70). Leave blank to keep what's saved."],
        ["Weight of 1 piece (g) and Weight of 1 ml (g): only needed when recipes use a different kind of unit than the price."],
        ["Rows whose name starts with \"Example\" show how to fill the sheet and are skipped. Delete them or leave them."],
      ],
      header: true,
    },
    priceListSheet(),
  ];
}
