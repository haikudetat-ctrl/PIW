"use client";

import { useActionState, useState, useTransition } from "react";
import { inputClasses, labelClasses, primaryButtonClasses, plainButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { inviteMember, updateMember, type SettingsActionResult } from "../actions";

const ROLE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "manager", label: "Manager" },
  { value: "company_admin", label: "Company admin" },
] as const;

export function MemberControls({
  userId,
  name,
  role,
  isActive,
  locked,
}: {
  userId: string;
  name: string;
  role: string;
  isActive: boolean;
  // Nobody changes their own role or access, so an admin can't lock
  // themselves out.
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;

  if (locked) return <span className="text-ink">{label}</span>;

  const save = (nextRole: string, nextActive: boolean) =>
    startTransition(async () => {
      const result = await updateMember(userId, nextRole, nextActive);
      setError("error" in result ? result.error : null);
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <select
          aria-label={`Role for ${name}`}
          className="rounded-md border border-transparent bg-transparent py-0.5 pr-1 text-[13px] text-ink hover:border-border-strong focus:border-tint focus:outline-none"
          defaultValue={role}
          disabled={pending}
          onChange={(event) => save(event.target.value, isActive)}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${plainButtonClasses} ${isActive ? "text-danger" : ""}`}
          disabled={pending}
          onClick={() => save(role, !isActive)}
        >
          {isActive ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState<SettingsActionResult | null, FormData>(inviteMember, null);
  return (
    <section aria-label="Invite" className="rounded-2xl bg-surface p-5 shadow-card">
      <h3 className="text-[15px] font-semibold text-ink">Invite someone</h3>
      <p className="mt-0.5 text-xs text-ink-subtle">They get an email to set a password, then sign in to this company.</p>
      <form action={action} className="mt-4 grid items-end gap-3 md:grid-cols-[1fr_1fr_11rem_auto]">
        <label className={labelClasses}>
          Name
          <input name="displayName" required maxLength={120} className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Email
          <input name="email" type="email" required className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Role
          <select name="role" defaultValue="employee" className={inputClasses}>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={primaryButtonClasses}>
          <Icon name="plus" size={14} />
          {pending ? "Sending…" : "Invite"}
        </button>
      </form>
      {state ? (
        <p role="status" className={`mt-3 text-[13px] ${"error" in state ? "text-danger" : "text-success"}`}>
          {"error" in state ? state.error : state.message}
        </p>
      ) : null}
    </section>
  );
}
