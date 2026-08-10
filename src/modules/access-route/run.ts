import type { ServerEnv } from "@/lib/env/server";
import type { AccessRouteRepository, VendorSystem } from "./contracts";
import { VendorReadError } from "./http";
import {
  normalizeJobNimbusContact,
  normalizeJobNimbusJob,
  normalizeLeadConduitEvent,
  normalizeLeadConduitFlow,
  normalizeLeadMasterCustomField,
  normalizeLeadMasterRecord,
} from "./normalize";
import { JobNimbusReadClient, LeadConduitReadClient, LeadMasterReadClient } from "./vendors";

type ReadEnvironment = Pick<ServerEnv,
  | "ACCESS_ROUTE_COMPANY_ID"
  | "INTEGRATIONS_LEADCONDUIT_ENABLED"
  | "INTEGRATIONS_LEADMASTER_ENABLED"
  | "INTEGRATIONS_JOBNIMBUS_ENABLED"
  | "LEADCONDUIT_API_KEY"
  | "LEADCONDUIT_BASE_URL"
  | "LEADMASTER_ACCESS_TOKEN"
  | "LEADMASTER_BASE_URL"
  | "LEADMASTER_WORKGROUPS"
  | "LEADMASTER_LOOKBACK_MINUTES"
  | "JOBNIMBUS_API_KEY"
  | "JOBNIMBUS_BASE_URL"
  | "JOBNIMBUS_CONTACTS_PATH"
  | "JOBNIMBUS_JOBS_PATH"
  | "JOBNIMBUS_INCLUDE_SOLD_VALUE"
>;

type RunResult = {
  vendor: VendorSystem;
  outcome: "succeeded" | "failed" | "skipped";
  recordsSeen: number;
  recordsWritten: number;
  errorCategory?: string;
};

function syncSlotKey(vendor: VendorSystem, now: Date): string {
  const slot = new Date(now);
  slot.setUTCMinutes(now.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return `${vendor}:${slot.toISOString()}`;
}

function errorCategory(error: unknown): string {
  if (error instanceof VendorReadError) return error.category;
  return "persistence_or_mapping";
}

async function executeVendor(input: {
  vendor: VendorSystem;
  companyId: string;
  now: Date;
  repository: AccessRouteRepository;
  task: () => Promise<{ seen: number; written: number; cursor?: string | null; metadata?: Record<string, unknown> }>;
}): Promise<RunResult> {
  const run = await input.repository.beginRun({
    companyId: input.companyId,
    sourceSystem: input.vendor,
    syncKey: syncSlotKey(input.vendor, input.now),
  });
  if (run.duplicate) return { vendor: input.vendor, outcome: "skipped", recordsSeen: 0, recordsWritten: 0 };

  try {
    const result = await input.task();
    await input.repository.finishRun({
      runId: run.id,
      outcome: "succeeded",
      recordsSeen: result.seen,
      recordsWritten: result.written,
      nextCursor: result.cursor,
      metadata: result.metadata,
    });
    return { vendor: input.vendor, outcome: "succeeded", recordsSeen: result.seen, recordsWritten: result.written };
  } catch (error) {
    const category = errorCategory(error);
    await input.repository.finishRun({
      runId: run.id,
      outcome: "failed",
      recordsSeen: 0,
      recordsWritten: 0,
      errorCategory: category,
    });
    return { vendor: input.vendor, outcome: "failed", recordsSeen: 0, recordsWritten: 0, errorCategory: category };
  }
}

export async function runAccessRouteSync(input: {
  environment: ReadEnvironment;
  repository: AccessRouteRepository;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<{ enabled: boolean; results: RunResult[] }> {
  const now = input.now ?? new Date();
  const env = input.environment;
  const enabled = env.INTEGRATIONS_LEADCONDUIT_ENABLED
    || env.INTEGRATIONS_LEADMASTER_ENABLED
    || env.INTEGRATIONS_JOBNIMBUS_ENABLED;
  if (!enabled) return { enabled: false, results: [] };
  const companyId = await input.repository.getCompanyId(env.ACCESS_ROUTE_COMPANY_ID);
  const tasks: Promise<RunResult>[] = [];

  if (env.INTEGRATIONS_LEADCONDUIT_ENABLED && env.LEADCONDUIT_API_KEY) {
    tasks.push(executeVendor({
      vendor: "leadconduit",
      companyId,
      now,
      repository: input.repository,
      task: async () => {
        const client = new LeadConduitReadClient({
          apiKey: env.LEADCONDUIT_API_KEY!,
          baseUrl: env.LEADCONDUIT_BASE_URL,
          fetcher: input.fetcher,
        });
        const cursor = await input.repository.getLastCursor(companyId, "leadconduit");
        const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const [flows, events] = await Promise.all([client.flows(), client.events({ start, afterId: cursor })]);
        const ingestedAt = now.toISOString();
        const flowRows = flows.map((row) => normalizeLeadConduitFlow(row, companyId, ingestedAt)).filter((row) => row !== null);
        const eventRows = events.rows.map((row) => normalizeLeadConduitEvent(row, companyId, ingestedAt)).filter((row) => row !== null);
        const [flowCount, eventCount] = await Promise.all([
          input.repository.upsertLeadConduitFlows(flowRows),
          input.repository.upsertLeadConduitEvents(eventRows),
        ]);
        return {
          seen: flows.length + events.rows.length,
          written: flowCount + eventCount,
          cursor: events.cursor,
          metadata: { flow_count: flows.length, event_count: events.rows.length, read_only: true },
        };
      },
    }));
  }

  if (env.INTEGRATIONS_LEADMASTER_ENABLED && env.LEADMASTER_ACCESS_TOKEN) {
    tasks.push(executeVendor({
      vendor: "leadmaster",
      companyId,
      now,
      repository: input.repository,
      task: async () => {
        const client = new LeadMasterReadClient({
          accessToken: env.LEADMASTER_ACCESS_TOKEN!,
          baseUrl: env.LEADMASTER_BASE_URL,
          lookbackMinutes: env.LEADMASTER_LOOKBACK_MINUTES,
          fetcher: input.fetcher,
        });
        const [leads, opportunities, fields] = await Promise.all([
          client.leads(),
          client.opportunities(),
          client.customFields(),
        ]);
        const ingestedAt = now.toISOString();
        const allowedWorkgroups = new Set((env.LEADMASTER_WORKGROUPS ?? "")
          .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
        const records = [
          ...leads.map((row) => normalizeLeadMasterRecord(row, "lead", companyId, ingestedAt)),
          ...opportunities.map((row) => normalizeLeadMasterRecord(row, "opportunity", companyId, ingestedAt)),
        ].filter((row) => row !== null)
          .filter((row) => !row.workgroup || allowedWorkgroups.size === 0 || allowedWorkgroups.has(row.workgroup.toLowerCase()));
        const customFields = fields.map((row) => normalizeLeadMasterCustomField(row, companyId, ingestedAt)).filter((row) => row !== null);
        const [recordCount, fieldCount] = await Promise.all([
          input.repository.upsertLeadMasterRecords(records),
          input.repository.upsertLeadMasterCustomFields(customFields),
        ]);
        return {
          seen: leads.length + opportunities.length + fields.length,
          written: recordCount + fieldCount,
          metadata: {
            lead_count: leads.length,
            opportunity_count: opportunities.length,
            custom_field_count: fields.length,
            timestamp_field: "Date Entered",
            quick_action_date_range_used: false,
            read_only: true,
          },
        };
      },
    }));
  }

  if (env.INTEGRATIONS_JOBNIMBUS_ENABLED && env.JOBNIMBUS_API_KEY) {
    tasks.push(executeVendor({
      vendor: "jobnimbus",
      companyId,
      now,
      repository: input.repository,
      task: async () => {
        const client = new JobNimbusReadClient({
          apiKey: env.JOBNIMBUS_API_KEY!,
          baseUrl: env.JOBNIMBUS_BASE_URL,
          contactsPath: env.JOBNIMBUS_CONTACTS_PATH,
          jobsPath: env.JOBNIMBUS_JOBS_PATH,
          fetcher: input.fetcher,
        });
        const [contacts, jobs] = await Promise.all([client.contacts(), client.jobs()]);
        const ingestedAt = now.toISOString();
        const contactRows = contacts.map((row) => normalizeJobNimbusContact(row, companyId, ingestedAt)).filter((row) => row !== null);
        const jobRows = jobs.map((row) => normalizeJobNimbusJob(
          row,
          companyId,
          ingestedAt,
          env.JOBNIMBUS_INCLUDE_SOLD_VALUE,
        )).filter((row) => row !== null);
        const [contactCount, jobCount] = await Promise.all([
          input.repository.upsertJobNimbusContacts(contactRows),
          input.repository.upsertJobNimbusJobs(jobRows),
        ]);
        return {
          seen: contacts.length + jobs.length,
          written: contactCount + jobCount,
          metadata: { contact_count: contacts.length, job_count: jobs.length, read_only: true },
        };
      },
    }));
  }

  return { enabled: true, results: await Promise.all(tasks) };
}
