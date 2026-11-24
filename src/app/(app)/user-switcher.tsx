"use client";

/** Demo mode: switch to any user without a password. */
export function UserSwitcher({ current, users }: { current: string; users: { id: string; name: string; email: string }[] }) {
  return (
    <form action="/auth/demo" method="get" className="flex items-center gap-2">
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        Demo
      </span>
      <label htmlFor="user-switcher" className="hidden text-stone-500 lg:inline">
        Viewing as
      </label>
      <select
        id="user-switcher"
        name="user"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-48 rounded-lg border border-stone-300 bg-white py-1.5 pl-2.5 pr-8 text-sm text-stone-800"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </form>
  );
}
