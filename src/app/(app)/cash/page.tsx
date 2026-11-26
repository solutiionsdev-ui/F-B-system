import { redirect } from "next/navigation";

/** Cash movements are a tab of Performance › Ledger, and are entered in Daily Close (v2.1). */
export default function CashPage() {
  redirect("/expenses?tab=movements");
}
