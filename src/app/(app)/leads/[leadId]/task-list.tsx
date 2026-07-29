import { dueStatus } from "@/modules/tasks/due-status";
import { createTask, completeTask } from "./task-actions";

type Task = {
  id: string;
  title: string;
  due_at: string | null;
  status: "open" | "complete" | "cancelled";
};

export function TaskList({ leadId, tasks }: { leadId: string; tasks: Task[] }) {
  const now = new Date();

  return (
    <section aria-label="Tasks">
      <h2>Tasks</h2>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.title} — {task.status} ({dueStatus({ dueAt: task.due_at, status: task.status }, now)})
            {task.status === "open" ? (
              <form
                action={async () => {
                  "use server";
                  await completeTask(leadId, task.id);
                }}
              >
                <button type="submit">Mark complete</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        action={async (formData) => {
          "use server";
          await createTask(leadId, formData);
        }}
      >
        <label>
          New task
          <input name="title" required />
        </label>
        <label>
          Due
          <input name="dueAt" type="datetime-local" />
        </label>
        <button type="submit">Add task</button>
      </form>
    </section>
  );
}
