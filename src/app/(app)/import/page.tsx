import { redirect } from "next/navigation";

/** Tonight's file is imported in Daily Close step 1; formats and history are in Settings & Log (v2.1). */
export default function ImportPage() {
  redirect("/settings/pos");
}
