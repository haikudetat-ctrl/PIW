import type { AccessRouteRepository } from "./contracts";
import { normalizeJobNimbusContact, normalizeJobNimbusJob } from "./normalize";
import { JobNimbusReadClient } from "./vendors";

export type JobNimbusEnvironment = {
  INTEGRATIONS_JOBNIMBUS_ENABLED: boolean;
  JOBNIMBUS_API_KEY?: string;
  JOBNIMBUS_BASE_URL?: string;
  JOBNIMBUS_CONTACTS_PATH?: string;
  JOBNIMBUS_JOBS_PATH?: string;
  JOBNIMBUS_INCLUDE_SOLD_VALUE: boolean;
  JOBNIMBUS_PAGE_LIMIT: number;
  JOBNIMBUS_MAX_PAGES: number;
};

export type JobNimbusCanaryResult = {
  outcome: "succeeded" | "failed";
  contactsSeen: number;
  contactsWritten: number;
  jobsSeen: number;
  jobsWritten: number;
  errorCategory?: string;
};

export async function importJobNimbusCanary(_input: {
  companyId: string;
  environment: JobNimbusEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<JobNimbusCanaryResult> {
  const input = _input;
  const now = input.now ?? new Date();
  const run = await input.repository.beginRun({
    companyId: input.companyId,
    sourceSystem: "jobnimbus",
    syncKey: `jobnimbus:canary:${now.toISOString()}`,
  });
  if (run.duplicate) {
    return {
      outcome: "failed",
      contactsSeen: 0,
      contactsWritten: 0,
      jobsSeen: 0,
      jobsWritten: 0,
      errorCategory: "persistence_or_mapping",
    };
  }

  const metadata = { mode: "canary", read_only: true } as const;
  if (!input.environment.JOBNIMBUS_API_KEY) {
    await input.repository.finishRun({
      runId: run.id,
      outcome: "failed",
      recordsSeen: 0,
      recordsWritten: 0,
      errorCategory: "authentication",
      metadata,
    });
    return {
      outcome: "failed",
      contactsSeen: 0,
      contactsWritten: 0,
      jobsSeen: 0,
      jobsWritten: 0,
      errorCategory: "authentication",
    };
  }

  const client = new JobNimbusReadClient({
    apiKey: input.environment.JOBNIMBUS_API_KEY,
    baseUrl: input.environment.JOBNIMBUS_BASE_URL,
    contactsPath: input.environment.JOBNIMBUS_CONTACTS_PATH,
    jobsPath: input.environment.JOBNIMBUS_JOBS_PATH,
    pageLimit: input.environment.JOBNIMBUS_PAGE_LIMIT,
    maxPages: input.environment.JOBNIMBUS_MAX_PAGES,
    fetcher: input.fetcher,
  });
  const probe = await client.probe();
  const failedProbe = [probe.contacts, probe.jobs].find((result) => !result.ok);
  if (failedProbe) {
    const errorCategory = failedProbe.errorCategory ?? "upstream";
    await input.repository.finishRun({
      runId: run.id,
      outcome: "failed",
      recordsSeen: 0,
      recordsWritten: 0,
      errorCategory,
      metadata,
    });
    return {
      outcome: "failed",
      contactsSeen: 0,
      contactsWritten: 0,
      jobsSeen: 0,
      jobsWritten: 0,
      errorCategory,
    };
  }

  let contactsSeen = 0;
  let contactsWritten = 0;
  let jobsSeen = 0;
  let jobsWritten = 0;
  try {
    const [contacts, jobs] = await Promise.all([client.contacts(), client.jobs()]);
    contactsSeen = contacts.length;
    jobsSeen = jobs.length;
    const ingestedAt = now.toISOString();
    const contactRows = contacts
      .map((record) => normalizeJobNimbusContact(record, input.companyId, ingestedAt))
      .filter((row) => row !== null);
    const jobRows = jobs
      .map((record) => normalizeJobNimbusJob(
        record,
        input.companyId,
        ingestedAt,
        input.environment.JOBNIMBUS_INCLUDE_SOLD_VALUE,
      ))
      .filter((row) => row !== null);

    contactsWritten = await input.repository.upsertJobNimbusContacts(contactRows);
    jobsWritten = await input.repository.upsertJobNimbusJobs(jobRows);
    await input.repository.finishRun({
      runId: run.id,
      outcome: "succeeded",
      recordsSeen: contactsSeen + jobsSeen,
      recordsWritten: contactsWritten + jobsWritten,
      metadata: {
        ...metadata,
        contact_count: contactsSeen,
        job_count: jobsSeen,
      },
    });
    return {
      outcome: "succeeded",
      contactsSeen,
      contactsWritten,
      jobsSeen,
      jobsWritten,
    };
  } catch {
    await input.repository.finishRun({
      runId: run.id,
      outcome: "failed",
      recordsSeen: contactsSeen + jobsSeen,
      recordsWritten: contactsWritten + jobsWritten,
      errorCategory: "persistence_or_mapping",
      metadata,
    });
    return {
      outcome: "failed",
      contactsSeen,
      contactsWritten,
      jobsSeen,
      jobsWritten,
      errorCategory: "persistence_or_mapping",
    };
  }
}
