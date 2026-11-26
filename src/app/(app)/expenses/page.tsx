import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth";

/** Entry moved to Daily Close step 2; the period lists to Performance › Ledger (v2.1). */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.can("view_reports")) redirect("/close#step-2");
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  redirect(`/performance/ledger${q.size ? `?${q}` : ""}`);
}
