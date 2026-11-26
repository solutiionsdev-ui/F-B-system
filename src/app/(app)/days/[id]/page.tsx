import { notFound, redirect } from "next/navigation";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getDay } from "@/server/operations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A business day now lives in Daily Close (v2.1): switch to its branch and open its date there. */
export default async function DayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireContext();
  // Row-level security: a day at a venue this person can't see isn't found.
  const d = await getDay(await getDb(), ctx.scope, id);
  if (!d) notFound();
  const next = `/close?date=${d.day.businessDate}`;
  redirect(`/branch?location=${d.day.locationId}&next=${encodeURIComponent(next)}`);
}
