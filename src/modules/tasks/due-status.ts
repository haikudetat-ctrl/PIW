export type TaskDueStatus = "none" | "upcoming" | "overdue";

export function dueStatus(
  task: { dueAt: string | null; status: "open" | "complete" | "cancelled" },
  now: Date,
): TaskDueStatus {
  if (task.status !== "open" || !task.dueAt) return "none";
  return new Date(task.dueAt).getTime() < now.getTime() ? "overdue" : "upcoming";
}
