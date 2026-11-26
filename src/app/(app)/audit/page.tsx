import { redirect } from "next/navigation";

/** Moved into Settings & Log (v2.1). */
export default function AuditPage() {
  redirect("/settings/audit");
}
