import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import {
  formatAppointmentTime,
  isOpenAppointment,
  type AppointmentOutcome,
  type AppointmentStatus,
} from "@/modules/appointments/booking";
import { setAppointmentStatus } from "../../appointments/actions";
import { AppointmentForm } from "./appointment-form";

type Appointment = {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: AppointmentStatus;
  notes: string | null;
  reps: { name: string } | Array<{ name: string }> | null;
};

const STATUS_TONE: Record<AppointmentStatus, BadgeTone> = {
  scheduled: "info",
  confirmed: "success",
  completed: "success",
  cancelled: "neutral",
  no_show: "danger",
};

const ACTIONS: Array<{ status: AppointmentOutcome; label: string; when: AppointmentStatus[] }> = [
  { status: "confirmed", label: "Confirmed", when: ["scheduled"] },
  { status: "completed", label: "Ran", when: ["scheduled", "confirmed"] },
  { status: "no_show", label: "No-show", when: ["scheduled", "confirmed"] },
  { status: "cancelled", label: "Cancelled", when: ["scheduled", "confirmed"] },
];

export function AppointmentList({
  leadId,
  appointments,
  reps,
}: {
  leadId: string;
  appointments: Appointment[];
  reps: Array<{ id: string; name: string }>;
}) {
  return (
    <Card title="Inspections" ariaLabel="Inspections">
      <ul className="flex flex-col divide-y divide-border">
        {appointments.map((appointment) => {
          const rep = Array.isArray(appointment.reps) ? appointment.reps[0] : appointment.reps;
          return (
            <li key={appointment.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{formatAppointmentTime(appointment.scheduled_at)}</span>
                <Badge tone={STATUS_TONE[appointment.status]}>{humanize(appointment.status)}</Badge>
              </div>
              <p className="text-xs text-ink-muted">
                {rep?.name ?? "No rep assigned"}
                {appointment.duration_minutes ? ` · ${appointment.duration_minutes} min` : ""}
                {appointment.notes ? ` · ${appointment.notes}` : ""}
              </p>
              {isOpenAppointment(appointment.status) ? (
                <div className="flex flex-wrap gap-3">
                  {ACTIONS.filter((item) => item.when.includes(appointment.status)).map((item) => (
                    <form
                      key={item.status}
                      action={async () => {
                        "use server";
                        await setAppointmentStatus(leadId, appointment.id, item.status);
                      }}
                    >
                      <button type="submit" className="text-xs font-medium text-accent hover:underline">
                        {item.label}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
        {appointments.length === 0 ? (
          <li className="py-2.5 text-sm text-ink-subtle">No inspection booked yet</li>
        ) : null}
      </ul>
      <AppointmentForm leadId={leadId} reps={reps} />
    </Card>
  );
}
