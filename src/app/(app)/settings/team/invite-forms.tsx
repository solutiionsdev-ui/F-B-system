"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { createInviteAction, renewInviteAction, revokeInviteAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";
import { ROLE_LABEL, ROLES, type RoleValue } from "@/lib/roles";
import { LinkBox } from "./link-box";

export function InviteForm({ orgName, full, venues }: { orgName: string; full: boolean; venues: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createInviteAction, initialActionState);
  const [role, setRole] = useState<RoleValue>("manager");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.at && state.data) ref.current?.reset();
  }, [state.at, state.data]);

  return (
    <div className="space-y-4">
      <form
        ref={ref}
        onReset={() => setRole("manager")}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
      >
        <label className="block">
          <span className={labelClass}>Email</span>
          <input name="email" type="email" required placeholder="name@example.com" className={inputClass} disabled={full} />
        </label>
        <fieldset>
          <legend className={labelClass}>Role</legend>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer gap-2 rounded-lg border border-stone-200 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  defaultChecked={r.value === "manager"}
                  onChange={() => setRole(r.value)}
                  className="mt-0.5 accent-brand-700"
                />
                <span>
                  <span className="block font-medium text-stone-900">{r.label}</span>
                  <span className="block text-xs text-stone-500">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === "owner" ? (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">Owners see every venue.</p>
        ) : (
          <fieldset>
            <legend className={labelClass}>Venues they can see</legend>
            <div className="space-y-1.5">
              {venues.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-sm text-stone-800">
                  <input type="checkbox" name="locationIds" value={v.id} defaultChecked={venues.length === 1} className="accent-brand-700" />
                  {v.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">Pick at least one. You can change this later.</p>
          </fieldset>
        )}
        <label className="block">
          <span className={labelClass}>Note (optional)</span>
          <input name="note" maxLength={300} placeholder="e.g. Evening shift manager" className={inputClass} disabled={full} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || full} className={buttonClass("primary")}>
            {pending ? "Creating…" : "Create invitation"}
          </button>
          {!pending && state.error && <span className="text-sm font-medium text-red-700">{state.error}</span>}
          {full && <span className="text-sm text-stone-500">The plan&apos;s user allowance is full.</span>}
        </div>
      </form>
      {!pending && state.data && <LinkBox path={state.data.path} email={state.data.email} orgName={orgName} />}
    </div>
  );
}

export function PendingInvite({
  invite,
  orgName,
}: {
  invite: { id: string; email: string; role: RoleValue; expiresLabel: string; expired: boolean; venues: string; note: string | null };
  orgName: string;
}) {
  const [state, action, pending] = useActionState(renewInviteAction, initialActionState);
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-stone-800">{invite.email}</div>
          <div className={`text-xs ${invite.expired ? "text-red-700" : "text-stone-500"}`}>
            {ROLE_LABEL[invite.role]} · {invite.venues} · {invite.expired ? "Link expired" : `Link expires ${invite.expiresLabel}`}
          </div>
          {invite.note && <div className="text-xs text-stone-500">{invite.note}</div>}
        </div>
        <div className="flex items-center gap-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => action(fd));
            }}
          >
            <input type="hidden" name="inviteId" value={invite.id} />
            <button className={buttonClass("ghost")} disabled={pending}>
              {pending ? "…" : "New link"}
            </button>
          </form>
          <ActionForm
            action={revokeInviteAction}
            submitLabel="Cancel invite"
            variant="ghost"
            className="contents"
            confirmText={`Cancel the invitation for ${invite.email}?`}
          >
            <input type="hidden" name="inviteId" value={invite.id} />
          </ActionForm>
        </div>
      </div>
      {!pending && state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {!pending && state.data && <LinkBox path={state.data.path} email={state.data.email} orgName={orgName} />}
    </li>
  );
}
