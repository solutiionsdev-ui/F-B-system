import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { getContext, isDemoMode } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · FINCTRL" };

export default async function LoginPage() {
  if (isDemoMode()) redirect("/auth/demo");
  if (await getContext()) redirect("/");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo size={40} />
          </div>
          <h1 className="text-xl font-semibold tracking-[0.04em] text-stone-900">FINCTRL</h1>
          <p className="mt-1 text-sm text-stone-500">Know where your money goes, every day.</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-xs">
          <LoginForm />
        </div>
        <p className="mt-4 text-center text-xs text-stone-500">Demo logins are listed in README.md.</p>
      </div>
    </main>
  );
}
