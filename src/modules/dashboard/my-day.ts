// The home screen ("My day"): who to call now, what is due, and what sold.
// Times follow the company's calendar, not the server's UTC clock.
const COMPANY_TIME_ZONE = "America/New_York";

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

function dayKey(date: Date): string {
  const { year, month, day } = zonedParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// UTC instant of local midnight on a company calendar date.
function zonedMidnight(year: number, month: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const offsetHours = zonedParts(guess).hour; // local hour at UTC midnight
  const shift = offsetHours === 0 ? 0 : 24 - offsetHours;
  return new Date(guess.getTime() + shift * 3_600_000);
}

export function greeting(now: Date): string {
  const { hour } = zonedParts(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatToday(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: COMPANY_TIME_ZONE,
  });
}

export function startOfMonth(now: Date): Date {
  const { year, month } = zonedParts(now);
  return zonedMidnight(year, month, 1);
}

export function startOfDay(now: Date): Date {
  const { year, month, day } = zonedParts(now);
  return zonedMidnight(year, month, day);
}

export function formatWaiting(since: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Speed to lead: under 5 minutes is on time, under an hour is late, past that
// the lead has gone cold.
export function waitingTone(since: string, now: Date): "ok" | "late" | "cold" {
  const minutes = (now.getTime() - new Date(since).getTime()) / 60_000;
  if (minutes < 5) return "ok";
  if (minutes < 60) return "late";
  return "cold";
}

export type RespondNowItem = {
  key: string;
  name: string;
  detail: string;
  href: string;
  phone: string | null;
  since: string;
  value: string | null;
  source: "rake" | "jobnimbus";
};

export type RespondNowLead = {
  id: string;
  name: string;
  phone: string;
  submitted_address: string;
  source_system: string;
  created_at: string;
  estimate: string | null;
};

export type RespondNowJob = {
  jnid: string;
  number: string | null;
  name: string | null;
  phone: string | null;
  address: string | null;
  source: string | null;
  created_at: string;
};

// New Rake leads nobody has tried yet and new JobNimbus leads, newest first.
export function buildRespondNow(leads: RespondNowLead[], jobs: RespondNowJob[], limit: number): RespondNowItem[] {
  const items: RespondNowItem[] = [
    ...leads.map((lead) => ({
      key: `lead-${lead.id}`,
      name: lead.name,
      detail: [sourceLabel(lead.source_system), lead.submitted_address].filter(Boolean).join(" · "),
      href: `/leads/${lead.id}`,
      phone: lead.phone || null,
      since: lead.created_at,
      value: lead.estimate,
      source: "rake" as const,
    })),
    ...jobs.map((job) => ({
      key: `job-${job.jnid}`,
      name: job.name?.trim() || (job.number ? `Job #${job.number}` : "JobNimbus lead"),
      detail: [job.source, job.address].filter(Boolean).join(" · "),
      href: `/jobs/${encodeURIComponent(job.jnid)}`,
      phone: job.phone,
      since: job.created_at,
      value: null,
      source: "jobnimbus" as const,
    })),
  ];
  return items.sort((a, b) => b.since.localeCompare(a.since)).slice(0, limit);
}

// Leads from the website roof estimate arrive as canonical-roof-assessment.
const WEBSITE_SOURCES = new Set(["canonical-roof-assessment", "piw_intake", "roof_estimate"]);

function sourceLabel(sourceSystem: string): string {
  if (WEBSITE_SOURCES.has(sourceSystem)) return "Website";
  return sourceSystem.replace(/[-_]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

export type DayTask = { id: string; title: string; due_at: string | null; lead_id: string; lead_name: string; lead_stage: string };

export function groupTasks(tasks: DayTask[], now: Date) {
  const today = dayKey(now);
  const overdue: DayTask[] = [];
  const dueToday: DayTask[] = [];
  const upcoming: DayTask[] = [];
  for (const task of [...tasks].sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))) {
    if (task.due_at && new Date(task.due_at).getTime() < now.getTime()) overdue.push(task);
    else if (task.due_at && dayKey(new Date(task.due_at)) === today) dueToday.push(task);
    else upcoming.push(task);
  }
  return { overdue, dueToday, upcoming };
}

export function formatDue(dueAt: string | null, now: Date): string {
  if (!dueAt) return "No date";
  const due = new Date(dueAt);
  const days = Math.round((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86_400_000);
  if (due.getTime() < now.getTime()) {
    if (days <= 0) return "Today";
    return days === 1 ? "Yesterday" : `${days}d late`;
  }
  if (dayKey(due) === dayKey(now)) {
    return due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: COMPANY_TIME_ZONE });
  }
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: COMPANY_TIME_ZONE });
}
