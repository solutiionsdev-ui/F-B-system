import { redirect } from "next/navigation";

/** The rate is changed from the badge on Daily Close; the history is in Settings & Log (v2.1). */
export default function RatesPage() {
  redirect("/settings/rates");
}
