"use client";

import { useActionState, useTransition } from "react";
import { inputClasses, labelClasses, plainButtonClasses, primaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { createCompany, switchCompany, type SettingsActionResult } from "../actions";

export function CompanySwitchButton({ companyId, name }: { companyId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={plainButtonClasses}
      disabled={pending}
      aria-label={`Switch to ${name}`}
      onClick={() => startTransition(() => switchCompany(companyId))}
    >
      {pending ? "Switching…" : "Switch to"}
    </button>
  );
}

export function CreateCompanyForm() {
  const [state, action, pending] = useActionState<SettingsActionResult | null, FormData>(createCompany, null);
  return (
    <section aria-label="Create a company" className="rounded-2xl bg-surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold text-ink">Create a company</h3>
      <p className="mt-0.5 text-xs text-ink-subtle">
        The JobNimbus sync stays off until that environment variable holds the company&apos;s API key on the server.
      </p>
      <form action={action} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className={labelClasses}>
          Company name
          <input name="name" required maxLength={120} className={inputClasses} />
        </label>
        <label className={labelClasses}>
          JobNimbus key variable (optional)
          <input name="jobnimbusEnvKey" placeholder="JOBNIMBUS_API_KEY_ACME" className={inputClasses} />
        </label>
        <label className={labelClasses}>
          First admin&apos;s name (optional)
          <input name="adminName" maxLength={120} className={inputClasses} />
        </label>
        <label className={labelClasses}>
          First admin&apos;s email (optional)
          <input name="adminEmail" type="email" className={inputClasses} />
        </label>
        <div className="md:col-span-2">
          <button type="submit" disabled={pending} className={primaryButtonClasses}>
            <Icon name="plus" size={14} />
            {pending ? "Creating…" : "Create company"}
          </button>
        </div>
      </form>
      {state ? (
        <p role="status" className={`mt-3 text-[13px] ${"error" in state ? "text-danger" : "text-success"}`}>
          {"error" in state ? state.error : state.message}
        </p>
      ) : null}
    </section>
  );
}
