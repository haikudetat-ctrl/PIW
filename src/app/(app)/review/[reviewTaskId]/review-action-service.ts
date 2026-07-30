import {
  createEventEnvelope,
  type DomainEvent,
} from "@/domain/events";

export type ReviewAction = "resolve" | "reject" | "retry" | "unsupported";

type ReviewResolution = {
  newStatus: "resolved" | "rejected" | "retried" | "unsupported";
  pipelineRunId: string;
  propertyId: string;
  nextAttempt: number | null;
};

export type RetryContext = {
  triggeringEventName:
    | "property/address.validation_requested"
    | "property/discovery_requested";
  pipelineRunId: string;
  correlationId: string;
  leadId: string;
  propertyId: string;
  submittedAddress: string;
  canonicalAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

type ReviewActionInput = {
  companyId: string;
  reviewTaskId: string;
  adminId: string;
  action: ReviewAction;
  selectedCandidateIndex: number | null;
  notes: string | null;
};

export type ReviewActionDependencies = {
  resolveTask(input: ReviewActionInput): Promise<ReviewResolution>;
  writeAudit(input: {
    companyId: string;
    actorId: string;
    action: string;
    entityType: "review_task";
    entityId: string;
    metadata: { action: ReviewAction };
  }): Promise<void>;
  loadRetryContext(input: {
    companyId: string;
    reviewTaskId: string;
  }): Promise<RetryContext>;
  enqueueRetry(companyId: string, event: DomainEvent): Promise<void>;
};

export function auditActionFor(action: ReviewAction): string {
  return {
    resolve: "review.task_resolved",
    reject: "review.task_rejected",
    retry: "review.task_retried",
    unsupported: "review.task_unsupported",
  }[action];
}

function buildRetryEvent(
  context: RetryContext,
  nextAttempt: number,
): DomainEvent {
  if (context.triggeringEventName === "property/address.validation_requested") {
    return createEventEnvelope({
      name: context.triggeringEventName,
      correlationId: context.correlationId,
      pipelineRunId: context.pipelineRunId,
      leadId: context.leadId,
      propertyId: context.propertyId,
      data: {
        leadId: context.leadId,
        propertyId: context.propertyId,
        submittedAddress: context.submittedAddress,
        attempt: nextAttempt,
      },
    });
  }

  if (!context.canonicalAddress) {
    throw new Error("Discovery retry requires a canonical address");
  }

  return createEventEnvelope({
    name: context.triggeringEventName,
    correlationId: context.correlationId,
    pipelineRunId: context.pipelineRunId,
    leadId: context.leadId,
    propertyId: context.propertyId,
    data: {
      leadId: context.leadId,
      propertyId: context.propertyId,
      canonicalAddress: context.canonicalAddress,
      latitude: context.latitude,
      longitude: context.longitude,
      attempt: nextAttempt,
    },
  });
}

export async function applyReviewActionCore(
  input: ReviewActionInput,
  dependencies: ReviewActionDependencies,
): Promise<ReviewResolution> {
  const resolution = await dependencies.resolveTask(input);

  await dependencies.writeAudit({
    companyId: input.companyId,
    actorId: input.adminId,
    action: auditActionFor(input.action),
    entityType: "review_task",
    entityId: input.reviewTaskId,
    metadata: { action: input.action },
  });

  if (input.action === "retry") {
    if (!resolution.nextAttempt) {
      throw new Error("Retry action did not return a next attempt");
    }
    const context = await dependencies.loadRetryContext({
      companyId: input.companyId,
      reviewTaskId: input.reviewTaskId,
    });
    const event = buildRetryEvent(context, resolution.nextAttempt);
    await dependencies.enqueueRetry(input.companyId, event);
  }

  return resolution;
}
