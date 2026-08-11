import type {
  AccessRouteRepository,
  JsonRecord,
  LeadConduitProbeResult,
  LeadConduitRuleScope,
} from "./contracts";
import type {
  LeadConduitFlowSlug,
  LeadConduitReadEnvironment,
} from "./leadconduit-config";
import { basicAuth, getJson, VendorReadError } from "./http";
import {
  asArray,
  asRecord,
  normalizeLeadConduitEvent,
  normalizeLeadConduitFlow,
  normalizeLeadConduitFlowRule,
  normalizeLeadConduitFlowStep,
  normalizeLeadConduitSourceMetadata,
  readString,
} from "./normalize";
import { LeadConduitReadClient } from "./vendors";

const SHADOW_EVENT_LIMIT = 50;
const EXPECTED_FLOWS = [
  ["roofing", "Roofing"],
  ["roofing-virtual-quote", "Roofing Virtual Quote"],
] as const;

export type LeadConduitShadowResult = {
  outcome: "succeeded" | "failed";
  flowSlug: LeadConduitFlowSlug;
  flowSeen: boolean;
  sourceMetadataSeen: number;
  eventsSeen: number;
  eventsWritten: number;
  nextCursor: string | null;
  errorCategory?: string;
};

export type LeadConduitSanitizedProbeResult = {
  ok: boolean;
  status: number;
  visibleFlowCount: number;
  approvedFlows: Array<{
    flowName: "Roofing" | "Roofing Virtual Quote";
    sourceCount: number;
    fieldNames: string[];
  }>;
  missingFlowNames: Array<"Roofing" | "Roofing Virtual Quote">;
};

class ShadowImportError extends Error {
  constructor(readonly category: string) {
    super(category);
    this.name = "ShadowImportError";
  }
}

function flowIdForSlug(
  flowSlug: LeadConduitFlowSlug,
  environment: LeadConduitReadEnvironment,
): string | null {
  return flowSlug === "roofing"
    ? environment.LEADCONDUIT_ROOFING_FLOW_ID ?? null
    : environment.LEADCONDUIT_VIRTUAL_QUOTE_FLOW_ID ?? null;
}

function approvedFlowMap(environment: LeadConduitReadEnvironment): ReadonlyMap<string, string> | null {
  const entries = EXPECTED_FLOWS.map(([slug, name]) => [flowIdForSlug(slug, environment), name] as const);
  if (entries.some(([flowId]) => !flowId)) return null;
  return new Map(entries as Array<readonly [string, string]>);
}

function sanitizeProbe(result: LeadConduitProbeResult): LeadConduitSanitizedProbeResult {
  const approvedFlows = result.approvedFlows.flatMap((flow) => {
    if (flow.flowName !== "Roofing" && flow.flowName !== "Roofing Virtual Quote") return [];
    const flowName: "Roofing" | "Roofing Virtual Quote" = flow.flowName;
    return [{
      flowName,
      sourceCount: flow.sourceCount,
      fieldNames: [...flow.fieldNames],
    }];
  });
  const missingFlowNames = result.missingFlowNames.filter(
    (name): name is "Roofing" | "Roofing Virtual Quote" => (
      name === "Roofing" || name === "Roofing Virtual Quote"
    ),
  );
  const complete = result.ok && approvedFlows.length === EXPECTED_FLOWS.length && missingFlowNames.length === 0;
  return {
    ok: complete,
    status: result.status,
    visibleFlowCount: result.visibleFlowCount,
    approvedFlows,
    missingFlowNames,
  };
}

function probeMetadata(result: LeadConduitSanitizedProbeResult): JsonRecord {
  return {
    status: result.status,
    visible_flow_count: result.visibleFlowCount,
    approved_flows: result.approvedFlows.map((flow) => ({
      flow_name: flow.flowName,
      source_count: flow.sourceCount,
      field_names: flow.fieldNames,
    })),
    missing_flow_names: result.missingFlowNames,
  };
}

export function leadConduitProbeFromMetadata(value: unknown): LeadConduitSanitizedProbeResult | null {
  const metadata = asRecord(value);
  if (!metadata) return null;
  const status = metadata.status;
  const visibleFlowCount = metadata.visible_flow_count;
  if (
    typeof status !== "number"
    || !Number.isInteger(status)
    || typeof visibleFlowCount !== "number"
    || !Number.isInteger(visibleFlowCount)
    || visibleFlowCount < 0
  ) return null;
  const approvedFlows = records(metadata.approved_flows).flatMap((flow) => {
    const flowName = readString(flow, "flow_name");
    const sourceCount = flow.source_count;
    const fieldNames = flow.field_names;
    if (
      (flowName !== "Roofing" && flowName !== "Roofing Virtual Quote")
      || typeof sourceCount !== "number"
      || !Number.isInteger(sourceCount)
      || sourceCount < 0
      || !Array.isArray(fieldNames)
      || fieldNames.some((fieldName) => typeof fieldName !== "string")
    ) return [];
    const approvedFlowName: "Roofing" | "Roofing Virtual Quote" = flowName;
    return [{ approvedFlowName, sourceCount, fieldNames: [...fieldNames] as string[] }].map((item) => ({
      flowName: item.approvedFlowName,
      sourceCount: item.sourceCount,
      fieldNames: item.fieldNames,
    }));
  });
  const missingFlowNames = Array.isArray(metadata.missing_flow_names)
    ? metadata.missing_flow_names.filter(
        (name): name is "Roofing" | "Roofing Virtual Quote" => (
          name === "Roofing" || name === "Roofing Virtual Quote"
        ),
      )
    : [];
  return {
    ok: status >= 200
      && status < 300
      && approvedFlows.length === EXPECTED_FLOWS.length
      && missingFlowNames.length === 0,
    status,
    visibleFlowCount,
    approvedFlows,
    missingFlowNames,
  };
}

function emptyProbe(): LeadConduitSanitizedProbeResult {
  return {
    ok: false,
    status: 0,
    visibleFlowCount: 0,
    approvedFlows: [],
    missingFlowNames: EXPECTED_FLOWS.map(([, name]) => name),
  };
}

export async function probeLeadConduitConnection(input: {
  companyId: string;
  environment: LeadConduitReadEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<LeadConduitSanitizedProbeResult> {
  const now = input.now ?? new Date();
  const run = await input.repository.beginRun({
    companyId: input.companyId,
    sourceSystem: "leadconduit",
    syncKey: `leadconduit:probe:${now.toISOString()}`,
  });
  if (run.duplicate) return emptyProbe();

  let result = emptyProbe();
  let errorCategory: string | null = "authentication";
  const approvedFlows = approvedFlowMap(input.environment);
  if (input.environment.LEADCONDUIT_API_KEY && approvedFlows) {
    const client = new LeadConduitReadClient({
      apiKey: input.environment.LEADCONDUIT_API_KEY,
      baseUrl: input.environment.LEADCONDUIT_BASE_URL,
      fetcher: input.fetcher,
    });
    const vendorProbe = await client.probe({ approvedFlows });
    result = sanitizeProbe(vendorProbe);
    errorCategory = result.ok ? null : vendorProbe.errorCategory ?? "mapping";
  } else if (input.environment.LEADCONDUIT_API_KEY) {
    errorCategory = "mapping";
  }

  await input.repository.finishRun({
    runId: run.id,
    outcome: result.ok ? "succeeded" : "failed",
    recordsSeen: result.visibleFlowCount,
    recordsWritten: 0,
    ...(errorCategory ? { errorCategory } : {}),
    metadata: probeMetadata(result),
  });
  return result;
}

function endpoint(baseUrl: string | undefined, path: string): URL {
  const base = baseUrl ?? "https://app.leadconduit.com";
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

function sourceIds(flow: JsonRecord): string[] {
  if (!Array.isArray(flow.sources)) return [];
  return flow.sources.flatMap((source) => {
    if (typeof source === "string" && source.trim()) return [source.trim()];
    const sourceId = readString(asRecord(source) ?? {}, "id", "source_id");
    return sourceId ? [sourceId] : [];
  });
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? asArray(value) : [];
}

function acceptanceRules(record: JsonRecord): JsonRecord[] {
  const acceptance = asRecord(record.acceptance) ?? asRecord(record.acceptance_metadata);
  return acceptance ? records(acceptance.rules) : [];
}

function stepRules(step: JsonRecord): JsonRecord[] {
  const direct = records(step.rules);
  return direct.length ? direct : acceptanceRules(step);
}

function normalizedRules(input: {
  records: JsonRecord[];
  companyId: string;
  flowId: string;
  scope: LeadConduitRuleScope;
  scopeId: string;
  observedAt: string;
}) {
  const rows = input.records.map((record) => normalizeLeadConduitFlowRule(record, {
    companyId: input.companyId,
    flowId: input.flowId,
    ruleScope: input.scope,
    ruleScopeId: input.scopeId,
    observedAt: input.observedAt,
  }));
  if (rows.some((row) => row === null)) throw new ShadowImportError("mapping");
  return rows.filter((row) => row !== null);
}

function failureResult(
  flowSlug: LeadConduitFlowSlug,
  errorCategory: string,
  counts?: Pick<LeadConduitShadowResult, "flowSeen" | "sourceMetadataSeen" | "eventsSeen" | "eventsWritten">,
): LeadConduitShadowResult {
  return {
    outcome: "failed",
    flowSlug,
    flowSeen: counts?.flowSeen ?? false,
    sourceMetadataSeen: counts?.sourceMetadataSeen ?? 0,
    eventsSeen: counts?.eventsSeen ?? 0,
    eventsWritten: counts?.eventsWritten ?? 0,
    nextCursor: null,
    errorCategory,
  };
}

export async function importLeadConduitShadow(input: {
  companyId: string;
  flowSlug: LeadConduitFlowSlug;
  environment: LeadConduitReadEnvironment;
  repository: AccessRouteRepository;
  fetcher?: typeof fetch;
  now?: Date;
}): Promise<LeadConduitShadowResult> {
  const now = input.now ?? new Date();
  const observedAt = now.toISOString();
  const metadata = { mode: "shadow", read_only: true, flow_slug: input.flowSlug } as const;
  const run = await input.repository.beginRun({
    companyId: input.companyId,
    sourceSystem: "leadconduit",
    syncKey: `leadconduit:shadow:${input.flowSlug}:${observedAt}`,
  });
  if (run.duplicate) return failureResult(input.flowSlug, "persistence");

  let flowSeen = false;
  let sourceMetadataSeen = 0;
  let eventsSeen = 0;
  let eventsWritten = 0;
  const fail = async (errorCategory: string) => {
    await input.repository.finishRun({
      runId: run.id,
      outcome: "failed",
      recordsSeen: eventsSeen,
      recordsWritten: eventsWritten,
      errorCategory,
      metadata,
    });
    return failureResult(input.flowSlug, errorCategory, {
      flowSeen,
      sourceMetadataSeen,
      eventsSeen,
      eventsWritten,
    });
  };

  const apiKey = input.environment.LEADCONDUIT_API_KEY;
  const flowId = flowIdForSlug(input.flowSlug, input.environment);
  const approvedFlows = approvedFlowMap(input.environment);
  if (!apiKey) return fail("authentication");
  if (!flowId || !approvedFlows) return fail("mapping");
  if (
    !input.repository.upsertLeadConduitSourceMetadata
    || !input.repository.upsertLeadConduitFlowSteps
    || !input.repository.upsertLeadConduitFlowRules
  ) return fail("persistence");

  const client = new LeadConduitReadClient({
    apiKey,
    baseUrl: input.environment.LEADCONDUIT_BASE_URL,
    fetcher: input.fetcher,
  });

  try {
    const probe = await client.probe({ approvedFlows });
    if (!probe.ok || probe.missingFlowNames.length || probe.approvedFlows.length !== EXPECTED_FLOWS.length) {
      return fail(probe.errorCategory ?? "mapping");
    }

    const rawFlows = asArray(await getJson({
      vendor: "leadconduit",
      url: endpoint(input.environment.LEADCONDUIT_BASE_URL, "/flows"),
      headers: { Authorization: basicAuth("API", apiKey) },
      fetcher: input.fetcher,
    }));
    const selectedFlows = rawFlows.filter((flow) => readString(flow, "id") === flowId);
    if (selectedFlows.length !== 1) return fail("mapping");
    const selectedFlow = selectedFlows[0];
    flowSeen = true;

    const selectedSourceIds = sourceIds(selectedFlow);
    const sourceRecords = await Promise.all(
      selectedSourceIds.map((sourceId) => client.sourceMeta(flowId, sourceId)),
    );
    sourceMetadataSeen = sourceRecords.length;

    const pageLimit = Math.min(
      SHADOW_EVENT_LIMIT,
      Math.max(1, input.environment.LEADCONDUIT_SHADOW_PAGE_LIMIT || SHADOW_EVENT_LIMIT),
    );
    const start = new Date(
      now.getTime() - input.environment.LEADCONDUIT_INITIAL_LOOKBACK_MINUTES * 60_000,
    ).toISOString();
    const eventPage = await client.eventsPage({ flowId, start, limit: pageLimit });
    eventsSeen = eventPage.rows.length;

    const flowRow = normalizeLeadConduitFlow(selectedFlow, {
      companyId: input.companyId,
      flowId,
      observedAt,
    });
    if (!flowRow) throw new ShadowImportError("mapping");

    const sourceRows = sourceRecords.map((record, index) => normalizeLeadConduitSourceMetadata(record, {
      companyId: input.companyId,
      flowId,
      sourceId: selectedSourceIds[index],
      observedAt,
    }));
    const rawSteps = records(selectedFlow.steps);
    const stepRows = rawSteps.map((step) => normalizeLeadConduitFlowStep(step, {
      companyId: input.companyId,
      flowId,
      observedAt,
    }));
    if (stepRows.some((row) => row === null)) throw new ShadowImportError("mapping");

    const ruleRows = [
      ...normalizedRules({
        records: acceptanceRules(selectedFlow),
        companyId: input.companyId,
        flowId,
        scope: "flow_acceptance",
        scopeId: flowId,
        observedAt,
      }),
      ...sourceRecords.flatMap((record, index) => normalizedRules({
        records: acceptanceRules(record),
        companyId: input.companyId,
        flowId,
        scope: "source_acceptance",
        scopeId: selectedSourceIds[index],
        observedAt,
      })),
      ...rawSteps.flatMap((step) => (
        readString(step, "type", "step_type")?.toLowerCase() === "filter"
          ? normalizedRules({
              records: stepRules(step),
              companyId: input.companyId,
              flowId,
              scope: "filter_step",
              scopeId: readString(step, "id", "step_id") ?? "",
              observedAt,
            })
          : []
      )),
    ];
    const eventRows = eventPage.rows.map((record) => normalizeLeadConduitEvent(record, {
      companyId: input.companyId,
      flowId,
      channel: "poll",
      observedAt,
    }));
    if (eventRows.some((row) => row === null)) throw new ShadowImportError("flow_mismatch");

    const normalizedStepRows = stepRows.filter((row) => row !== null);
    const normalizedEventRows = eventRows.filter((row) => row !== null);
    let recordsWritten = 0;
    recordsWritten += await input.repository.upsertLeadConduitFlows({
      companyId: input.companyId,
      flowId,
      rows: [flowRow],
    });
    recordsWritten += await input.repository.upsertLeadConduitSourceMetadata({
      companyId: input.companyId,
      flowId,
      rows: sourceRows,
    });
    recordsWritten += await input.repository.upsertLeadConduitFlowSteps({
      companyId: input.companyId,
      flowId,
      rows: normalizedStepRows,
    });
    recordsWritten += await input.repository.upsertLeadConduitFlowRules({
      companyId: input.companyId,
      flowId,
      rows: ruleRows,
    });
    eventsWritten = await input.repository.upsertLeadConduitEvents({
      companyId: input.companyId,
      flowId,
      channel: "poll",
      observedAt,
      rows: normalizedEventRows,
    });
    recordsWritten += eventsWritten;
    const recordsSeen = 1 + sourceRows.length + normalizedStepRows.length + ruleRows.length + eventsSeen;
    await input.repository.finishRun({
      runId: run.id,
      outcome: "succeeded",
      recordsSeen,
      recordsWritten,
      nextCursor: eventPage.cursor,
      metadata,
    });
    return {
      outcome: "succeeded",
      flowSlug: input.flowSlug,
      flowSeen,
      sourceMetadataSeen,
      eventsSeen,
      eventsWritten,
      nextCursor: eventPage.cursor,
    };
  } catch (error) {
    const category = error instanceof VendorReadError
      ? error.category
      : error instanceof ShadowImportError
        ? error.category
        : "persistence";
    return fail(category);
  }
}
