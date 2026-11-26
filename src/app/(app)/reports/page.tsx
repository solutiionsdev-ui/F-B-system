import { redirect } from "next/navigation";

/** Reports became the Performance tab (v2.1). Downloads stay at /reports/export. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  redirect(`/performance${q.size ? `?${q}` : ""}`);
}
