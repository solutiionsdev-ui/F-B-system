import { redirect } from "next/navigation";

// The exchange rate now lives under Settings; old links and bookmarks land there.
export default function RatesPage() {
  redirect("/settings");
}
