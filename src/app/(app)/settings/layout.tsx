import type { ReactNode } from "react";
import { SubNav } from "@/components/sub-nav";
import { requireContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { getNavCounts } from "@/server/operations";

/**
 * Settings & Log (FINCTRL v2.1, tab 3): the saved Omega formats, Team &
 * Permissions, the append-only audit trail, the rate history and the
 * business's own settings. No fourth tab.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const counts = await getNavCounts(await getDb(), ctx.scope, ctx.branch?.id ?? null);
  const items = [
    { href: "/settings/pos", label: "Omega POS formats", count: ctx.can("import_pos") ? counts.importDrafts : 0 },
    ...(ctx.can("manage_team") ? [{ href: "/settings/team", label: "Team & Permissions", count: counts.pendingInvites }] : []),
    ...(ctx.can("view_audit") ? [{ href: "/settings/audit", label: "Audit Trail" }] : []),
    { href: "/settings/rates", label: "Rate history" },
    { href: "/settings/business", label: "Business" },
  ];
  return (
    <>
      <div className="mb-4">
        <div className="text-[13px] text-stone-500">{ctx.active.orgName}</div>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[30px]">Settings & Log</h1>
      </div>
      <SubNav items={items} label="Settings sections" />
      {children}
    </>
  );
}
