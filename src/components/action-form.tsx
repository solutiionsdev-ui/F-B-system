"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { buttonClass } from "./ui";

/**
 * A form wired to a server action. Typed values are kept when the server
 * rejects them (React would otherwise clear the form), and the form can
 * reset itself after a successful save.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  variant = "primary",
  resetOnSuccess = false,
  confirmText,
  className = "space-y-4",
  footerClassName = "",
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  resetOnSuccess?: boolean;
  confirmText?: string;
  className?: string;
  footerClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.at && resetOnSuccess) ref.current?.reset();
  }, [state.at, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      <div className={`flex flex-wrap items-center gap-3 ${footerClassName}`}>
        <button type="submit" disabled={pending} className={buttonClass(variant)}>
          {pending ? pendingLabel : submitLabel}
        </button>
        <span aria-live="polite" className="text-sm">
          {!pending && state.error && <span className="font-medium text-red-700">{state.error}</span>}
          {!pending && !state.error && state.ok && <span className="text-emerald-700">✓ {state.ok}</span>}
        </span>
      </div>
    </form>
  );
}
