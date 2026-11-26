import { redirect } from "next/navigation";

/** Settings & Log opens on the saved POS formats. */
export default function SettingsPage() {
  redirect("/settings/pos");
}
