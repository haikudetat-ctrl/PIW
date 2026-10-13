"use client";

import { useTransition } from "react";
import { switchCompany } from "./settings/actions";

export type SidebarCompany = { id: string; name: string; isCurrent: boolean };

// The active company under the logo. Anyone with more than one company (a
// super admin, or someone in two companies) can switch here.
export function CompanySwitcher({ companies }: { companies: SidebarCompany[] }) {
  const [pending, startTransition] = useTransition();
  const current = companies.find((company) => company.isCurrent);

  if (companies.length <= 1) {
    return <p className="mt-1.5 truncate text-xs text-ink-subtle">{current?.name ?? "New Jersey residential roofing"}</p>;
  }

  return (
    <select
      aria-label="Active company"
      className="mt-1 -ml-1 w-full truncate rounded-md border border-transparent bg-transparent py-0.5 text-xs text-ink-subtle hover:border-border-strong focus:border-tint focus:outline-none"
      value={current?.id ?? ""}
      disabled={pending}
      onChange={(event) => {
        const companyId = event.target.value;
        startTransition(() => switchCompany(companyId));
      }}
    >
      {current ? null : <option value="">Choose a company</option>}
      {companies.map((company) => (
        <option key={company.id} value={company.id}>
          {company.name}
        </option>
      ))}
    </select>
  );
}
