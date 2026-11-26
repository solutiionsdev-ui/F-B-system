import { redirect } from "next/navigation";

/** Days are opened from Daily Close now (v2.1). */
export default async function NewDayPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const { location } = await searchParams;
  redirect(location ? `/branch?location=${encodeURIComponent(location)}&next=${encodeURIComponent("/close")}` : "/close");
}
