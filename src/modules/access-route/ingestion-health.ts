// What the Access Route "Ingestion health" card says for each system. Each
// system reports through a different table: LeadConduit pushes webhooks into
// leadconduit_events, JobNimbus records its polls in jobnimbus_sync_runs, and
// LeadMaster will use integration_sync_runs.

export type IngestionTone = "ok" | "warning" | "danger" | "muted";

export type IngestionHealth = {
  lastAt: string | null;
  status: string;
  detail: string;
  tone: IngestionTone;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const NOT_CONFIGURED: IngestionHealth = {
  lastAt: null,
  status: "not configured",
  detail: "0 records",
  tone: "muted",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function leadConduitHealth(input: {
  lastReceivedAt: string | null;
  receivedLast24Hours: number;
  now: Date;
}): IngestionHealth {
  if (!input.lastReceivedAt) return NOT_CONFIGURED;
  const recent = input.now.getTime() - new Date(input.lastReceivedAt).getTime() <= DAY_MS;
  return {
    lastAt: input.lastReceivedAt,
    status: recent ? "receiving" : "quiet",
    detail: `${plural(input.receivedLast24Hours, "lead")} in 24h`,
    tone: recent ? "ok" : "warning",
  };
}

type JobNimbusRun = { started_at: string; status: string; records_changed: number | null };

// One poll writes a run per record type (contacts, jobs, estimates, files)
// within a few seconds. The latest poll is the runs started within 15 minutes
// of the newest one.
const POLL_WINDOW_MS = 15 * 60 * 1000;

export function jobNimbusHealth(runs: JobNimbusRun[]): IngestionHealth {
  const newest = runs.reduce<JobNimbusRun | null>(
    (latest, run) => (!latest || Date.parse(run.started_at) > Date.parse(latest.started_at) ? run : latest),
    null,
  );
  if (!newest) return NOT_CONFIGURED;
  const cutoff = new Date(newest.started_at).getTime() - POLL_WINDOW_MS;
  const poll = runs.filter((run) => new Date(run.started_at).getTime() >= cutoff);
  const failed = poll.find((run) => run.status !== "ok" && run.status !== "running");
  const running = poll.some((run) => run.status === "running");
  const changed = poll.reduce((sum, run) => sum + (run.records_changed ?? 0), 0);
  return {
    lastAt: newest.started_at,
    status: failed?.status ?? (running ? "running" : "ok"),
    detail: `${plural(changed, "record")} changed`,
    tone: failed ? "danger" : "ok",
  };
}

export function syncRunHealth(
  run: { started_at: string; outcome: string; records_written: number | null } | null | undefined,
): IngestionHealth {
  if (!run) return NOT_CONFIGURED;
  return {
    lastAt: run.started_at,
    status: run.outcome,
    detail: plural(run.records_written ?? 0, "record"),
    tone: run.outcome === "failed" ? "danger" : "ok",
  };
}
