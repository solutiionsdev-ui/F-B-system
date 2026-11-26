"use client";

// The buttons on a "Needs you" item: do the obvious next thing without
// leaving the page. Links navigate; the rest call server actions and
// confirm with a toast.
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  discardImportAction,
  quickImportAction,
  quickOpenDayAction,
  quickRenewInviteAction,
} from "@/app/actions";
import { useToast } from "@/components/toast";
import type { ActionState } from "@/lib/action-state";
import type { QuickAction } from "@/server/today";
import { LinkBox } from "./settings/team/link-box";

const base =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50";
const primary = `${base} bg-ink text-white hover:bg-stone-700`;
const secondary = `${base} border border-stone-200 bg-white text-stone-700 hover:bg-stone-50`;
const quiet = `${base} text-stone-500 hover:bg-stone-100 hover:text-stone-900`;

export function QuickActions({ actions, orgName }: { actions: QuickAction[]; orgName: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ path: string; email: string } | null>(null);
  const toast = useToast();

  if (actions.length === 0) return null;

  const run = (fn: () => Promise<ActionState | undefined>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res) return;
      if (res.error) setError(res.error);
      else {
        if (res.ok && toast) toast({ title: res.ok });
        if (res.data?.path) setLink({ path: res.data.path, email: res.data.email });
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((a) => {
          switch (a.kind) {
            case "link":
              return (
                <Link key={a.href + a.label} href={a.href} className={a.primary ? primary : secondary}>
                  {a.label}
                </Link>
              );
            case "import":
              return (
                <button key="import" type="button" disabled={pending} className={primary} onClick={() => run(() => quickImportAction(a.importId))}>
                  {pending ? "Importing…" : a.label}
                </button>
              );
            case "discard":
              return (
                <button
                  key="discard"
                  type="button"
                  disabled={pending}
                  className={quiet}
                  onClick={() => {
                    if (window.confirm("Discard this file? Nothing has been imported from it.")) run(() => discardImportAction(a.importId));
                  }}
                >
                  {a.label}
                </button>
              );
            case "renew":
              return (
                <button key="renew" type="button" disabled={pending} className={secondary} onClick={() => run(() => quickRenewInviteAction(a.inviteId))}>
                  {pending ? "Making link…" : a.label}
                </button>
              );
            case "open":
              return (
                <button key="open" type="button" disabled={pending} className={primary} onClick={() => run(() => quickOpenDayAction(a.locationId))}>
                  {pending ? "Opening…" : a.label}
                </button>
              );
          }
        })}
      </div>
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      {link && <LinkBox path={link.path} email={link.email} orgName={orgName} />}
    </div>
  );
}
