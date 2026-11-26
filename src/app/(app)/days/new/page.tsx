import Link from "next/link";
import { openDayAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageTitle } from "@/components/ui";
import { formatRate, parseRate } from "@/lib/money";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/operations";

export default async function NewDayPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const ctx = await requireContext();
  const { location } = await searchParams;
  const data = await getDashboard(await getDb(), ctx.scope);

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="Open a business day" subtitle="Record what's in the drawer before service starts." />
      <Card>
        {!data.rate ? (
          <p className="text-sm text-stone-600">
            Set an exchange rate first.{" "}
            <Link href="/settings" className="font-medium text-brand-700 underline">
              Set the rate
            </Link>
          </p>
        ) : (
          <ActionForm action={openDayAction} submitLabel="Open day" pendingLabel="Opening…">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location">
                <select name="locationId" defaultValue={location ?? data.locations[0]?.id} className={inputClass}>
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Business date">
                <input type="date" name="businessDate" defaultValue={data.today} className={inputClass} />
              </Field>
              <Field label="Opening float (USD)" hint="Cash in the drawer at the start of the day">
                <input name="float_USD" inputMode="decimal" placeholder="0.00" className={`${inputClass} num text-right`} />
              </Field>
              <Field label="Opening float (LBP)" hint="You can type 2m for 2,000,000">
                <input name="float_LBP" inputMode="decimal" placeholder="0" className={`${inputClass} num text-right`} />
              </Field>
            </div>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
              A day for today uses <span className="num font-medium text-stone-900">{formatRate(parseRate(data.rate.lbpPerUsd))} LBP / $</span>.
              A back-dated day uses the rate that was in force on its own date. Either way the day keeps its rate, even if the rate
              changes later.
            </p>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
