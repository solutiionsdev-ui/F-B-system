"use client";

import { loginAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…" footerClassName="[&>button]:w-full">
      <Field label="Email">
        <input name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
    </ActionForm>
  );
}
