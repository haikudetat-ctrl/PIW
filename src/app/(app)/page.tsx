import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { StatTile } from "@/components/ui/stat-tile";
import { parseMyAccess } from "@/lib/auth/access";
import { humanize } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import {
  buildRespondNow,
  formatDue,
  formatToday,
  formatWaiting,
  greeting,
  groupTasks,
  startOfDay,
  startOfMonth,
  waitingTone,
  type DayTask,
} from "@/modules/dashboard/my-day";
import { formatSyncAge } from "@/modules/jobs/job-detail";
import { jobStageTotals, jobnimbusPipelineSchema } from "@/modules/leads/jobnimbus-pipeline";
import { OPEN_STAGES, formatCompactCurrency } from "@/modules/leads/pipeline-view";

const RESPOND_NOW_LIMIT = 6;
const STUCK_THRESHOLD_MINUTES = 15;
const SYNC_STALE_HOURS = 3;
const DAY_MS = 86_400_000;

const WAIT_TONE = {
  ok: "bg-success-bg text-success",
  late: "bg-warning-bg text-warning",
  cold: "bg-danger-bg text-danger",
} as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function dollars(value: number): string {
  return formatCompactCurrency(Math.round(value * 100));
}

function TaskRow({ task, now, tone }: { task: DayTask; now: Date; tone: "danger" | "warning" | "neutral" }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">{task.title}</p>
        <Link href={`/leads/${task.lead_id}`} className="text-xs text-tint hover:underline">
          {task.lead_name} · {humanize(task.lead_stage)}
        </Link>
      </div>
      <Badge tone={tone} dot={false}>
        {formatDue(task.due_at, now)}
      </Badge>
    </li>
  );
}

export default async function MyDayPage() {
  const supabase = await createServerClient();
  const now = new Date();
  const monthStart = startOfMonth(now);
  const soldSince = new Date(Math.min(monthStart.getTime(), now.getTime() - 30 * DAY_MS));
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const dayStart = startOfDay(now);
  const stuckSince = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString();

  const [
    { data: accessData },
    { data: newLeads },
    { data: newJobs },
    { count: newLeadCount },
    { count: newJobCount },
    { data: taskRows },
    { data: pipelineData },
    { data: soldEvents },
    { data: appointments },
    { count: reviewCount },
    { count: stuckCount },
    { data: latestSync },
    { data: replies },
  ] = await Promise.all([
    supabase.rpc("get_my_access"),
    supabase
      .from("leads")
      .select("id, name, phone, submitted_address, source_system, created_at")
      .eq("is_test", false)
      .eq("stage", "new")
      .is("first_contact_attempted_at", null)
      .order("created_at", { ascending: false })
      .limit(RESPOND_NOW_LIMIT),
    supabase
      .from("jn_jobs")
      .select("jnid, number, primary_contact_jnid, address_line1, city, jn_created_at")
      .eq("status_name", "Lead")
      .gte("jn_created_at", weekAgo)
      .order("jn_created_at", { ascending: false })
      .limit(RESPOND_NOW_LIMIT),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("is_test", false).gte("created_at", weekAgo),
    supabase.from("jn_jobs").select("jnid", { count: "exact", head: true }).gte("jn_created_at", weekAgo),
    supabase
      .from("tasks")
      .select("id, title, due_at, lead_id, leads!inner(name, stage, is_test)")
      .eq("status", "open")
      .eq("leads.is_test", false)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase.rpc("pipeline_jobnimbus", { p_limit: 0 }),
    supabase
      .from("customer_journey_events")
      .select("source_ref, occurred_at")
      .eq("stage", "sold")
      .eq("source_system", "jobnimbus_job")
      .gte("occurred_at", soldSince.toISOString())
      .order("occurred_at", { ascending: false }),
    supabase
      .from("appointments")
      .select("id, scheduled_at, duration_minutes, status, lead_id, leads(name, submitted_address)")
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", new Date(dayStart.getTime() + DAY_MS).toISOString())
      .order("scheduled_at", { ascending: true }),
    supabase.from("review_tasks").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("pipeline_runs")
      .select("id", { count: "exact", head: true })
      .neq("status", "complete")
      .lt("started_at", stuckSince),
    supabase.from("jn_jobs").select("projected_at").order("projected_at", { ascending: false }).limit(1),
    supabase
      .from("sms_messages")
      .select("id, body, created_at, from_e164, lead_id, leads(name)")
      .eq("direction", "inbound")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // Second round: details for the rows found above.
  const leadIds = (newLeads ?? []).map((lead) => lead.id);
  const contactIds = (newJobs ?? []).flatMap((job) => (job.primary_contact_jnid ? [job.primary_contact_jnid] : []));
  const soldRefs = [...new Set((soldEvents ?? []).map((event) => event.source_ref))];
  const [{ data: estimates }, { data: contacts }, { data: soldJobs }] = await Promise.all([
    leadIds.length
      ? supabase.from("roof_estimates").select("lead_id, status, range_low_cents, range_high_cents").in("lead_id", leadIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? supabase.from("jn_contacts").select("jnid, display_name, phone_normalized, source_name").in("jnid", contactIds)
      : Promise.resolve({ data: [] }),
    soldRefs.length
      ? supabase
          .from("jn_jobs")
          .select("jnid, number, primary_contact_jnid, sales_rep_name, approved_total, estimate_total, city")
          .in("jnid", soldRefs)
      : Promise.resolve({ data: [] }),
  ]);

  const access = parseMyAccess(accessData);
  const firstName = access?.displayName?.split(/\s+/)[0] ?? null;

  const estimateByLead = new Map(
    (estimates ?? [])
      .filter((row) => row.status === "ready" && row.range_low_cents !== null && row.range_high_cents !== null)
      .map((row) => [
        row.lead_id,
        `${formatCompactCurrency(row.range_low_cents!)}–${formatCompactCurrency(row.range_high_cents!)}`,
      ]),
  );
  const contactById = new Map((contacts ?? []).map((contact) => [contact.jnid, contact]));
  const respondNow = buildRespondNow(
    (newLeads ?? []).map((lead) => ({ ...lead, estimate: estimateByLead.get(lead.id) ?? null })),
    (newJobs ?? []).map((job) => {
      const contact = job.primary_contact_jnid ? contactById.get(job.primary_contact_jnid) : undefined;
      return {
        jnid: job.jnid,
        number: job.number,
        name: contact?.display_name ?? null,
        phone: contact?.phone_normalized ?? null,
        address: [job.address_line1, job.city].filter(Boolean).join(", ") || null,
        source: contact?.source_name ?? null,
        created_at: job.jn_created_at ?? now.toISOString(),
      };
    }),
    RESPOND_NOW_LIMIT,
  );

  const tasks: DayTask[] = (taskRows ?? []).flatMap((row) => {
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    return lead ? [{ id: row.id, title: row.title, due_at: row.due_at, lead_id: row.lead_id, lead_name: lead.name, lead_stage: lead.stage }] : [];
  });
  const { overdue, dueToday, upcoming } = groupTasks(tasks, now);

  const pipeline = jobnimbusPipelineSchema.safeParse(pipelineData);
  const totals = pipeline.success ? jobStageTotals(pipeline.data) : {};
  const openJobs = OPEN_STAGES.reduce((sum, stage) => sum + (totals[stage]?.jobs ?? 0), 0);
  const openValueCents = OPEN_STAGES.reduce((sum, stage) => sum + (totals[stage]?.valueCents ?? 0), 0);

  const jobValue = (job: { approved_total: number | null; estimate_total: number | null }) =>
    Number(job.approved_total ?? 0) > 0 ? Number(job.approved_total) : Number(job.estimate_total ?? 0);
  const soldJobById = new Map((soldJobs ?? []).map((job) => [job.jnid, job]));
  const soldThisMonth = soldRefs.filter((ref) =>
    (soldEvents ?? []).some((event) => event.source_ref === ref && new Date(event.occurred_at) >= monthStart),
  );
  const soldThisMonthValue = soldThisMonth.reduce((sum, ref) => {
    const job = soldJobById.get(ref);
    return sum + (job ? jobValue(job) : 0);
  }, 0);
  const recentlySold = soldRefs.slice(0, 5).flatMap((ref) => {
    const job = soldJobById.get(ref);
    const event = (soldEvents ?? []).find((row) => row.source_ref === ref);
    return job && event ? [{ job, soldAt: event.occurred_at }] : [];
  });
  const soldContactIds = recentlySold.flatMap(({ job }) => (job.primary_contact_jnid ? [job.primary_contact_jnid] : []));
  const { data: soldContacts } = soldContactIds.length
    ? await supabase.from("jn_contacts").select("jnid, display_name").in("jnid", soldContactIds)
    : { data: [] };
  const soldNameById = new Map((soldContacts ?? []).map((contact) => [contact.jnid, contact.display_name]));

  const syncedAt = latestSync?.[0]?.projected_at ?? null;
  const syncStale = !syncedAt || now.getTime() - new Date(syncedAt).getTime() > SYNC_STALE_HOURS * 3_600_000;
  const attention = [
    (reviewCount ?? 0) > 0 && { label: `${reviewCount} awaiting review`, href: "/review", tone: "warning" as const },
    (stuckCount ?? 0) > 0 && {
      label: `${stuckCount} estimates stuck over ${STUCK_THRESHOLD_MINUTES} min`,
      href: "/review",
      tone: "danger" as const,
    },
    syncStale && { label: "JobNimbus hasn't synced in over 3 hours", href: "/reports/quality", tone: "danger" as const },
  ].filter((item): item is { label: string; href: string; tone: "warning" | "danger" } => Boolean(item));

  const dueNow = overdue.length + dueToday.length;
  const newThisWeek = (newLeadCount ?? 0) + (newJobCount ?? 0);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-subtle">{formatToday(now)}</p>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">
            {greeting(now)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-subtle">
          <span aria-hidden className={`size-[7px] rounded-full ${syncStale ? "bg-danger" : "bg-success"}`} />
          {syncedAt ? `JobNimbus synced ${formatSyncAge(syncedAt, now)}` : "JobNimbus not synced yet"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Sold this month"
          value={soldThisMonthValue > 0 ? dollars(soldThisMonthValue) : "—"}
          detail={`${soldThisMonth.length} signed ${soldThisMonth.length === 1 ? "job" : "jobs"}`}
          tone={soldThisMonth.length > 0 ? "success" : "default"}
        />
        <StatTile
          label="Open pipeline"
          value={openValueCents > 0 ? formatCompactCurrency(openValueCents) : "—"}
          detail={`${openJobs.toLocaleString()} active jobs · 6 months`}
        />
        <StatTile label="New leads" value={newThisWeek.toLocaleString()} detail="Last 7 days, Rake + JobNimbus" />
        <StatTile
          label="Tasks due"
          value={dueNow}
          detail={overdue.length > 0 ? `${overdue.length} overdue` : "Nothing overdue"}
          tone={overdue.length > 0 ? "danger" : dueNow > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="respond-now" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 px-1">
              <h2 id="respond-now" className="text-[17px] font-semibold tracking-tight text-ink">
                Respond now{" "}
                <span className="text-[13px] font-normal text-ink-subtle">{respondNow.length} waiting</span>
              </h2>
              <Link href="/pipeline?view=list&stage=new" className="text-[13px] font-medium text-tint hover:underline">
                View all
              </Link>
            </div>
            <ul className="overflow-hidden rounded-2xl bg-surface shadow-card">
              {respondNow.map((item) => (
                <li key={item.key} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-bg text-xs font-semibold text-info"
                  >
                    {initials(item.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={item.href} className="text-sm font-medium text-ink hover:text-tint">
                      {item.name}
                    </Link>
                    <p className="truncate text-xs text-ink-subtle">
                      {item.source === "jobnimbus" ? "JobNimbus · " : ""}
                      {item.detail}
                    </p>
                  </div>
                  {item.value ? <span className="hidden text-[13px] font-medium text-ink sm:inline">{item.value}</span> : null}
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${WAIT_TONE[waitingTone(item.since, now)]}`}
                  >
                    {formatWaiting(item.since, now)}
                  </span>
                  {item.phone ? (
                    <a href={`tel:${item.phone}`} className={`${primaryButtonClasses} shrink-0`}>
                      <Icon name="phone" size={14} /> Call
                    </a>
                  ) : (
                    <Link href={item.href} className={`${secondaryButtonClasses} shrink-0`}>
                      Open
                    </Link>
                  )}
                </li>
              ))}
              {respondNow.length === 0 ? (
                <li className="px-4 py-6 text-center text-[13px] text-ink-subtle">Everyone new has been contacted.</li>
              ) : null}
            </ul>
          </section>

          <section aria-labelledby="tasks" className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 px-1">
              <h2 id="tasks" className="text-[17px] font-semibold tracking-tight text-ink">
                Tasks
              </h2>
              <span className="text-[13px] text-ink-subtle">
                {overdue.length} overdue · {dueToday.length} today
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
              {tasks.length === 0 ? (
                <p className="px-5 py-6 text-center text-[13px] text-ink-subtle">No open tasks.</p>
              ) : (
                <>
                  {overdue.length > 0 ? (
                    <>
                      <p className="bg-surface-muted px-5 py-1.5 text-xs font-medium text-danger">Overdue</p>
                      <ul>
                        {overdue.map((task) => (
                          <TaskRow key={task.id} task={task} now={now} tone="danger" />
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {dueToday.length > 0 ? (
                    <>
                      <p className="bg-surface-muted px-5 py-1.5 text-xs font-medium text-ink-muted">Today</p>
                      <ul>
                        {dueToday.map((task) => (
                          <TaskRow key={task.id} task={task} now={now} tone="warning" />
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {upcoming.length > 0 ? (
                    <>
                      <p className="bg-surface-muted px-5 py-1.5 text-xs font-medium text-ink-muted">Coming up</p>
                      <ul>
                        {upcoming.slice(0, 5).map((task) => (
                          <TaskRow key={task.id} task={task} now={now} tone="neutral" />
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>

        <aside aria-label="Today and results" className="flex min-w-0 flex-col gap-5">
          {attention.length > 0 ? (
            <Card title="Needs attention">
              <ul className="flex flex-col gap-2">
                {attention.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2 text-[13px] font-medium hover:underline ${item.tone === "danger" ? "text-danger" : "text-warning"}`}
                    >
                      <span aria-hidden className="size-[7px] rounded-full bg-current" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="Replies" right={`${(replies ?? []).length} unread`}>
            {(replies ?? []).length > 0 ? (
              <ul className="flex flex-col">
                {(replies ?? []).map((reply) => {
                  const lead = Array.isArray(reply.leads) ? reply.leads[0] : reply.leads;
                  return (
                    <li key={reply.id} className="border-b border-border py-2 last:border-b-0">
                      <div className="flex items-baseline justify-between gap-2">
                        {reply.lead_id ? (
                          <Link
                            href={`/leads/${reply.lead_id}#conversation`}
                            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink hover:text-tint"
                          >
                            <span aria-hidden className="size-1.5 rounded-full bg-tint" />
                            {lead?.name ?? "Lead"}
                          </Link>
                        ) : (
                          <span className="text-[13px] font-medium text-ink">{reply.from_e164}</span>
                        )}
                        <span className="shrink-0 text-xs text-ink-subtle">{formatWaiting(reply.created_at, now)} ago</span>
                      </div>
                      <p className="truncate text-xs text-ink-muted">{reply.body}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-subtle">No unread texts.</p>
            )}
          </Card>

          <Card title="Today" right={`${(appointments ?? []).length} appointments`}>
            {(appointments ?? []).length > 0 ? (
              <ul className="flex flex-col">
                {(appointments ?? []).map((appointment) => {
                  const lead = Array.isArray(appointment.leads) ? appointment.leads[0] : appointment.leads;
                  return (
                    <li key={appointment.id} className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
                      <span className="w-14 shrink-0 text-[13px] font-semibold text-ink">
                        {new Date(appointment.scheduled_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "America/New_York",
                        })}
                      </span>
                      <div className="min-w-0 border-l-2 border-success pl-3">
                        <Link href={`/leads/${appointment.lead_id}`} className="text-[13px] font-medium text-ink hover:text-tint">
                          {lead?.name ?? "Appointment"}
                        </Link>
                        <p className="truncate text-xs text-ink-subtle">{lead?.submitted_address}</p>
                        <Badge tone={appointment.status === "scheduled" ? "neutral" : "success"}>
                          {humanize(appointment.status)}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-subtle">No appointments booked for today.</p>
            )}
          </Card>

          <Card title="Recently sold" right={<Link href="/reports/revenue" className="text-tint hover:underline">Revenue</Link>}>
            {recentlySold.length > 0 ? (
              <ul className="flex flex-col">
                {recentlySold.map(({ job, soldAt }) => (
                  <li key={job.jnid} className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
                    <div className="min-w-0">
                      <Link href={`/jobs/${encodeURIComponent(job.jnid)}`} className="text-[13px] font-medium text-ink hover:text-tint">
                        {(job.primary_contact_jnid && soldNameById.get(job.primary_contact_jnid)) ||
                          (job.number ? `Job #${job.number}` : "JobNimbus job")}
                      </Link>
                      <p className="truncate text-xs text-ink-subtle">
                        {[job.sales_rep_name, job.city].filter(Boolean).join(" · ") || "—"} ·{" "}
                        {new Date(soldAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-semibold text-ink">
                      {jobValue(job) > 0 ? dollars(jobValue(job)) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-subtle">No signed jobs in the last 30 days.</p>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
