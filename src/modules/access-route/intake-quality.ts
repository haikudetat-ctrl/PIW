import type { Database } from "@/lib/database.types";

// Vendor scorecard and lead feed for LeadConduit intake. Rows come from
// public.leadconduit_intake_quality; everything here is pure so the rules are
// tested without a database.

// Everything the page selects; company scoping is left to row-level security.
export type IntakeQualityRow = Omit<
  Database["public"]["Views"]["leadconduit_intake_quality"]["Row"],
  "company_id"
>;

export const INTAKE_FLAGS = [
  "repeat",
  "known_customer",
  "no_trustedform",
  "blank_address",
  "out_of_area",
  "incomplete",
] as const;
export type IntakeFlag = (typeof INTAKE_FLAGS)[number];

export const INTAKE_FLAG_LABELS: Record<IntakeFlag, string> = {
  repeat: "Repeat",
  known_customer: "In JobNimbus",
  no_trustedform: "No TrustedForm",
  blank_address: "No address",
  out_of_area: "Out of area",
  incomplete: "Incomplete",
};

export type IntakeFlagTone = "warning" | "danger" | "info";

export type IntakeFlagDetail = {
  flag: IntakeFlag;
  label: string;
  tone: IntakeFlagTone;
};

const TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_SOURCE = "Unknown source";

function isServiceStateKnown(row: IntakeQualityRow): boolean {
  return Boolean(row.service_states?.length);
}

export function intakeFlags(row: IntakeQualityRow): IntakeFlag[] {
  const redacted = row.contact_redacted === true;
  const flags: IntakeFlag[] = [];
  if (row.repeat_of_received_at) flags.push("repeat");
  if (row.jobnimbus_contact_since) flags.push("known_customer");
  if (!redacted && !row.has_trustedform) flags.push("no_trustedform");
  if (!redacted && !row.has_address) flags.push("blank_address");
  // An address whose state could not be read is not called out of area.
  if (row.has_address && row.state && isServiceStateKnown(row) && !row.service_states!.includes(row.state)) {
    flags.push("out_of_area");
  }
  if (!redacted && missingDetails(row).length > 0) flags.push("incomplete");
  return flags;
}

function missingDetails(row: IntakeQualityRow): string[] {
  const missing: string[] = [];
  if (!row.lead_name) missing.push("name");
  if (!row.has_phone) missing.push("phone");
  if (!row.has_email) missing.push("email");
  return missing;
}

const monthYear = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", year: "numeric" });

export function describeIntakeFlags(row: IntakeQualityRow): IntakeFlagDetail[] {
  return intakeFlags(row).map((flag) => {
    switch (flag) {
      case "repeat": {
        const other = row.repeat_of_source_name && row.repeat_of_source_name !== row.source_name
          ? ` (also ${row.repeat_of_source_name})`
          : "";
        return { flag, label: `Repeat${other}`, tone: "warning" };
      }
      case "known_customer":
        return {
          flag,
          label: `In JobNimbus since ${monthYear.format(new Date(row.jobnimbus_contact_since!))}`,
          tone: "info",
        };
      case "no_trustedform":
        return { flag, label: INTAKE_FLAG_LABELS.no_trustedform, tone: "warning" };
      case "blank_address":
        return { flag, label: INTAKE_FLAG_LABELS.blank_address, tone: "danger" };
      case "out_of_area":
        return { flag, label: `Out of area (${row.state})`, tone: "danger" };
      case "incomplete":
        return { flag, label: `Missing ${missingDetails(row).join(", ")}`, tone: "warning" };
    }
  });
}

export type FlagCounts = Record<IntakeFlag, number>;

export type SourceScore = {
  sourceName: string;
  today: number;
  last7Days: number;
  last30Days: number;
  // Counted over the 30-day window.
  flags: FlagCounts;
};

export type IntakeScorecard = {
  sources: SourceScore[];
  total: SourceScore;
  serviceStatesConfigured: boolean;
};

function emptyFlags(): FlagCounts {
  return Object.fromEntries(INTAKE_FLAGS.map((flag) => [flag, 0])) as FlagCounts;
}

function emptyScore(sourceName: string): SourceScore {
  return { sourceName, today: 0, last7Days: 0, last30Days: 0, flags: emptyFlags() };
}

const easternDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function easternDateKey(value: Date): string {
  return easternDay.format(value);
}

export function summarizeIntakeBySource(rows: IntakeQualityRow[], now: Date): IntakeScorecard {
  const todayKey = easternDateKey(now);
  const since7 = now.getTime() - 7 * DAY_MS;
  const since30 = now.getTime() - 30 * DAY_MS;
  const bySource = new Map<string, SourceScore>();
  const total = emptyScore("All sources");

  for (const row of rows) {
    if (!row.received_at) continue;
    const receivedAt = new Date(row.received_at);
    const time = receivedAt.getTime();
    if (time < since30 || time > now.getTime()) continue;

    const sourceName = row.source_name?.trim() || UNKNOWN_SOURCE;
    const score = bySource.get(sourceName) ?? emptyScore(sourceName);
    bySource.set(sourceName, score);

    for (const target of [score, total]) {
      target.last30Days += 1;
      if (time >= since7) target.last7Days += 1;
      if (easternDateKey(receivedAt) === todayKey) target.today += 1;
      for (const flag of intakeFlags(row)) target.flags[flag] += 1;
    }
  }

  const sources = [...bySource.values()].sort(
    (a, b) => b.last30Days - a.last30Days || a.sourceName.localeCompare(b.sourceName),
  );
  return {
    sources,
    total,
    serviceStatesConfigured: rows.some(isServiceStateKnown),
  };
}

export function formatShare(count: number, of: number): string {
  if (of === 0 || count === 0) return "";
  return `${Math.round((count / of) * 100)}%`;
}

const clock = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
const dayAndClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// "Today 4:55 PM", "Yesterday 8:12 AM", otherwise "Nov 10, 8:12 AM" (Eastern).
export function formatReceived(iso: string, now: Date): string {
  const value = new Date(iso);
  const key = easternDateKey(value);
  if (key === easternDateKey(now)) return `Today ${clock.format(value)}`;
  if (key === easternDateKey(new Date(now.getTime() - DAY_MS))) return `Yesterday ${clock.format(value)}`;
  return dayAndClock.format(value);
}

export function formatTown(row: Pick<IntakeQualityRow, "city" | "state" | "has_address" | "contact_redacted">): string {
  const city = row.city?.trim();
  if (city && row.state) return `${city}, ${row.state}`;
  if (row.contact_redacted) return "Redacted";
  if (!row.has_address) return "No address";
  return row.state ?? "Unreadable address";
}
