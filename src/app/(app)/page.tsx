import { redirect } from "next/navigation";
import { homePath } from "@/lib/navigation";
import { requireContext } from "@/server/auth";

/** FINCTRL v2.1: managers land on Daily Close, owners and accountants on Performance. */
export default async function Home() {
  const ctx = await requireContext();
  redirect(homePath(ctx.scope));
}
