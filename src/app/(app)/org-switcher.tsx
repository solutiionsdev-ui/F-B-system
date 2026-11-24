"use client";

import { switchOrgAction } from "@/app/actions";

export function OrgSwitcher({ active, options }: { active: string; options: { id: string; label: string }[] }) {
  if (options.length < 2) {
    return <span className="font-medium text-stone-800">{options[0]?.label}</span>;
  }
  return (
    <form action={switchOrgAction}>
      <label className="sr-only" htmlFor="org-switcher">
        Restaurant group
      </label>
      <select
        id="org-switcher"
        name="orgId"
        defaultValue={active}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-stone-300 bg-white py-1.5 pl-2.5 pr-8 text-sm font-medium text-stone-800"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}
