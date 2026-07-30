import { dueStatus } from "@/modules/tasks/due-status";
import { createTask, completeTask } from "./task-actions";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
import { humanize } from "@/lib/format";

type Task = {
  id: string;
  title: string;
  due_at: string | null;
  status: "open" | "complete" | "cancelled";
};

const DUE_TONE: Record<string, BadgeTone> = {
  overdue: "danger",
  upcoming: "info",
  none: "neutral",
};

const STATUS_TONE: Record<Task["status"], BadgeTone> = {
  open: "warning",
  complete: "success",
  cancelled: "neutral",
};

export function TaskList({ leadId, tasks }: { leadId: string; tasks: Task[] }) {
  const now = new Date();

  return (
    <Card title="Tasks" ariaLabel="Tasks">
      <ul className="flex flex-col divide-y divide-border">
        {tasks.map((task) => {
          const due = dueStatus({ dueAt: task.due_at, status: task.status }, now);
          return (
            <li
              key={task.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink">{task.title}</span>
                <Badge tone={STATUS_TONE[task.status]}>{humanize(task.status)}</Badge>
                {due !== "none" && <Badge tone={DUE_TONE[due]}>{humanize(due)}</Badge>}
              </div>
              {task.status === "open" ? (
                <form
                  action={async () => {
                    "use server";
                    await completeTask(leadId, task.id);
                  }}
                >
                  <button
                    type="submit"
                    className="shrink-0 text-xs font-medium text-accent hover:underline"
                  >
                    Mark complete
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
        {tasks.length === 0 ? (
          <li className="py-2.5 text-sm text-ink-subtle">No tasks yet</li>
        ) : null}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await createTask(leadId, formData);
        }}
        className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
      >
        <label className={`${labelClasses} flex-1`}>
          New task
          <input name="title" required className={inputClasses} />
        </label>
        <label className={labelClasses}>
          Due
          <input name="dueAt" type="datetime-local" className={inputClasses} />
        </label>
        <button type="submit" className={primaryButtonClasses}>
          Add task
        </button>
      </form>
    </Card>
  );
}
