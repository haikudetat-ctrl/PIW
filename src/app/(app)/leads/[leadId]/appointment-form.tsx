"use client";

import { useActionState, useRef } from "react";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
import { bookAppointment, type AppointmentFormState } from "../../appointments/actions";

export function AppointmentForm({
  leadId,
  reps,
}: {
  leadId: string;
  reps: Array<{ id: string; name: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<AppointmentFormState, FormData>(async (previous, formData) => {
    const result = await bookAppointment(leadId, previous, formData);
    if (result?.ok) formRef.current?.reset();
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className={labelClasses}>
          Inspection time (Eastern)
          <input name="scheduledAt" type="datetime-local" required className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Length (min)
          <input name="durationMinutes" type="number" min={15} max={480} step={15} defaultValue={60} className={inputClasses} />
        </label>
      </div>
      <label className={labelClasses}>
        Rep
        <select name="repId" defaultValue="" className={inputClasses}>
          <option value="">Assign later</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {rep.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClasses}>
        Notes
        <input name="notes" placeholder="Gate code, who'll be home…" className={inputClasses} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className={`text-xs ${state && !state.ok ? "text-danger" : "text-ink-subtle"}`}>
          {state && !state.ok ? state.message : state?.ok ? "Inspection booked." : null}
        </p>
        <button type="submit" disabled={pending} className={`${primaryButtonClasses} ml-auto`}>
          {pending ? "Booking…" : "Book inspection"}
        </button>
      </div>
    </form>
  );
}
