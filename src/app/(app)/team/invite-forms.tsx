"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { createInviteAction, renewInviteAction, revokeInviteAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { buttonClass, inputClass, labelClass } from "@/components/ui";
import { initialActionState } from "@/lib/action-state";
import { ROLE_LABEL, ROLES, type RoleValue } from "@/lib/roles";
import { LinkBox } from "./link-box";

export function InviteForm({ orgName, full }: { orgName: string; full: boolean }) {
  const [state, action, pending] = useActionState(createInviteAction, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.at && state.data) ref.current?.reset();
  }, [state.at, state.data]);

  return (
    <div className="space-y-4">
      <form
        ref={ref}
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
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer gap-2 rounded-lg border border-stone-200 p-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input type="radio" name="role" value={r.value} defaultChecked={r.value === "manager"} className="mt-0.5 accent-brand-700" />
                <span>
                  <span className="block font-medium text-stone-900">{r.label}</span>
                  <span className="block text-xs text-stone-500">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
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
  invite: { id: string; email: string; role: RoleValue; expiresLabel: string; expired: boolean };
  orgName: string;
}) {
  const [state, action, pending] = useActionState(renewInviteAction, initialActionState);
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-stone-800">{invite.email}</div>
          <div className={`text-xs ${invite.expired ? "text-red-700" : "text-stone-500"}`}>
            {ROLE_LABEL[invite.role]} · {invite.expired ? "Link expired" : `Link expires ${invite.expiresLabel}`}
          </div>
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
