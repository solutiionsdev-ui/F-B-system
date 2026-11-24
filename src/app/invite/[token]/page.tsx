import Link from "next/link";
import { acceptInviteAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Field, inputClass, Logo } from "@/components/ui";
import { ROLE_LABEL, ROLES } from "@/lib/roles";
import { getDb } from "@/server/db";
import { getInviteByToken } from "@/server/team";

export const metadata = { title: "Join · Cash Control", robots: { index: false } };

const PROBLEMS = {
  missing: "This invitation link isn't valid. Check you copied the whole link.",
  expired: "This invitation has expired. Ask the owner to send a new link.",
  used: "This invitation has already been used.",
  revoked: "This invitation was cancelled. Ask the owner for a new one.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInviteByToken(await getDb(), token);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={40} />
          </div>
          {invite.status === "valid" ? (
            <>
              <h1 className="text-xl font-semibold text-stone-900">Join {invite.orgName}</h1>
              <p className="mt-1 text-sm text-stone-500">
                You&apos;ve been invited as <span className="font-medium text-stone-700">{ROLE_LABEL[invite.role!]}</span> using{" "}
                {invite.email}.
              </p>
            </>
          ) : (
            <h1 className="text-xl font-semibold text-stone-900">Cash Control</h1>
          )}
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-xs">
          {invite.status !== "valid" ? (
            <div className="space-y-4 text-sm">
              <p className="text-stone-700">{PROBLEMS[invite.status]}</p>
              {invite.status === "used" && (
                <Link href="/" className={buttonClass("primary")}>
                  Go to Cash Control
                </Link>
              )}
            </div>
          ) : (
            <ActionForm
              action={acceptInviteAction.bind(null, token)}
              submitLabel={`Join ${invite.orgName}`}
              pendingLabel="Joining…"
              footerClassName="[&>button]:w-full"
            >
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                {ROLES.find((r) => r.value === invite.role)?.description}.
              </p>
              {invite.existingUser ? (
                <Field label="Your password" hint={`You already have an account with ${invite.email}. Enter its password to join.`}>
                  <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
                </Field>
              ) : (
                <>
                  <Field label="Your name">
                    <input name="name" autoComplete="name" required className={inputClass} />
                  </Field>
                  <Field label="Choose a password" hint="At least 8 characters.">
                    <input name="password" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
                  </Field>
                </>
              )}
            </ActionForm>
          )}
        </div>
      </div>
    </main>
  );
}
