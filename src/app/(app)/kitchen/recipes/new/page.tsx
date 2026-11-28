import Link from "next/link";
import { Card } from "@/components/ui";
import { formatScaled } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { recipeOptions } from "@/server/kitchen";
import { getDashboard } from "@/server/operations";
import { KitchenTitle } from "../../kitchen-ui";
import { RecipeEditor } from "../recipe-editor";

export default async function NewRecipePage() {
  const ctx = await requireContext();
  const db = await getDb();
  if (!ctx.can("manage_recipes")) {
    return (
      <>
        <KitchenTitle title="New recipe" />
        <Card>
          <p className="text-sm text-stone-600">Only people allowed to edit recipes can add them.</p>
        </Card>
      </>
    );
  }
  const [opts, dash] = await Promise.all([recipeOptions(db, ctx.scope), getDashboard(db, ctx.scope)]);
  return (
    <>
      <KitchenTitle
        title="New recipe"
        subtitle={
          <>
            A dish is what the menu sells; a prep is a sauce or base made in batches and used inside dishes.{" "}
            {opts.ingredients.length === 0 && (
              <>
                Add ingredients first, in{" "}
                <Link href="/kitchen/inventory" className="underline">
                  Inventory
                </Link>
                .
              </>
            )}
          </>
        }
      />
      <Card>
        <RecipeEditor
          defaultTargetPct={formatScaled(BigInt(dash.org.foodCostTargetBp), 2)}
          ingredients={opts.ingredients}
          preps={opts.preps}
          initial={{ name: "", kind: "dish", category: "", sellingPrice: "", priceCurrency: "USD", packaging: "", targetPct: "", yieldQty: "", yieldUnit: "g", lines: [] }}
        />
      </Card>
    </>
  );
}
