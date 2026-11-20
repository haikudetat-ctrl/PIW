"use client";

import { useActionState, useState } from "react";
import { inputClasses, labelClasses } from "@/components/ui/form";
import { recordSignoff, type SignoffState } from "./actions";
import { SignaturePad } from "./signature-pad";

export type SignoffFormProps = {
  closeoutId: string;
  version: number;
  jobJnid: string;
  punchItems: string | null;
  statementComplete: string;
  statementWithItems: string;
  photoReleaseText: string;
  reviewRequestText: string;
};

function YesNo({ name, legend, help }: { name: string; legend: string; help: string }) {
  return (
    <fieldset className="rounded-xl border border-border p-4">
      <legend className="px-1 text-[15px] font-semibold text-ink">{legend}</legend>
      <p className="text-[13px] text-ink-muted">{help}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[
          { value: name === "photoRelease" ? "granted" : "yes", label: "Yes" },
          { value: name === "photoRelease" ? "declined" : "no", label: "No" },
        ].map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center justify-center rounded-lg border border-border-strong py-3 text-[15px] font-medium text-ink transition has-checked:border-tint has-checked:bg-fill-selected has-checked:text-tint"
          >
            <input type="radio" name={name} value={option.value} required className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SignoffForm(props: SignoffFormProps) {
  const [state, formAction, pending] = useActionState<SignoffState, FormData>(recordSignoff, { error: null });
  const [outcome, setOutcome] = useState<"complete" | "complete_with_items">(props.punchItems ? "complete_with_items" : "complete");
  const [signed, setSigned] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="closeoutId" value={props.closeoutId} />
      <input type="hidden" name="version" value={props.version} />
      <input type="hidden" name="jobJnid" value={props.jobJnid} />

      {props.punchItems ? (
        <fieldset className="rounded-xl border border-border p-4">
          <legend className="px-1 text-[15px] font-semibold text-ink">Open items</legend>
          <p className="text-[15px] whitespace-pre-line text-ink">{props.punchItems}</p>
          <div className="mt-3 flex flex-col gap-2">
            {(
              [
                ["complete_with_items", "The work is complete except these items"],
                ["complete", "These are taken care of. The work is complete"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-3 text-[15px] text-ink">
                <input
                  type="radio"
                  name="outcome"
                  value={value}
                  checked={outcome === value}
                  onChange={() => setOutcome(value)}
                  className="size-5 accent-[var(--color-tint)]"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="outcome" value="complete" />
      )}

      <section className="rounded-xl bg-surface-muted p-4">
        <p className="text-[15px] leading-relaxed text-ink">
          {outcome === "complete" ? props.statementComplete : props.statementWithItems}
        </p>
      </section>

      <YesNo name="photoRelease" legend="Photos of your roof" help={props.photoReleaseText} />
      <YesNo name="reviewRequestOk" legend="Review link" help={props.reviewRequestText} />

      <label className={`${labelClasses} text-[13px]`}>
        Your name
        <input name="homeownerName" autoComplete="name" required maxLength={120} className={`${inputClasses} py-3 text-[16px]`} />
      </label>

      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-muted">Your signature</p>
        <SignaturePad name="signaturePath" onChange={(path) => setSigned(path.length > 0)} />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !signed}
        className="rounded-xl bg-accent py-3.5 text-[16px] font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
      >
        {pending ? "Saving…" : "Sign and finish"}
      </button>
    </form>
  );
}
