import { redirect } from "next/navigation";

/** Cash Close is step 3 of Daily Close; its history is in Performance (v2.1). */
export default function ClosingPage() {
  redirect("/close");
}
