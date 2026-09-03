import "server-only";
import {z} from "zod";
import {createServiceClient} from "@/lib/supabase/service";
import type {
  LeadConduitResult,
  MetaDistributionLead,
  MetaLeadSource,
} from "./meta-lead-distribution";

export type LeadDistributionDestination = "activeprospect" | "internal_email";
export type LeadDistributionCompletion = LeadConduitResult["status"];

export type ClaimedLeadDistribution = {
  deliveryId: string;
  companyId: string;
  destination: LeadDistributionDestination;
  sourceLabel: MetaLeadSource;
  attemptCount: number;
  lead: MetaDistributionLead;
};

const claimedSchema = z.object({
  delivery_id: z.uuid(), company_id: z.uuid(), lead_id: z.uuid(),
  destination: z.enum(["activeprospect", "internal_email"]),
  source_label: z.enum(["Meta70", "Meta30"]), attempt_count: z.number().int().positive(),
  name: z.string().min(1), phone: z.string().min(1), email: z.email(),
  submitted_address: z.string().min(1), notes: z.string().nullable(),
  source_system: z.string().min(1),
  source_submitted_at: z.iso.datetime({offset: true}), trustedform_url: z.string().nullable(),
  source_ip_address: z.string().nullable(), source_user_agent: z.string().nullable(),
  utm_source: z.string().nullable(), utm_campaign: z.string().nullable(),
}).strict();

const completionSchema = z.object({
  id: z.uuid(), status: z.enum(["sent", "rejected", "retryable_failed", "permanent_failed"]),
}).passthrough();
const pendingSchema = z.array(z.object({
  delivery_id: z.uuid(), lead_id: z.uuid(),
  destination: z.enum(["activeprospect", "internal_email"]),
  source_label: z.enum(["Meta70", "Meta30"]),
}).strict()).max(100);

type RpcClient = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>};

export class LeadDistributionRepositoryError extends Error {
  constructor(operation: string) {
    super(`Lead distribution persistence failed during ${operation}`);
    this.name = "LeadDistributionRepositoryError";
  }
}

export class SupabaseLeadDistributionRepository {
  constructor(
    private readonly client: RpcClient = createServiceClient() as unknown as RpcClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claim(deliveryId: string, companyId: string): Promise<ClaimedLeadDistribution | null> {
    const {data, error} = await this.client.rpc("claim_lead_distribution_delivery", {
      p_delivery_id: deliveryId,
      p_company_id: companyId,
      p_now: this.now().toISOString(),
    });
    if (error) throw new LeadDistributionRepositoryError("claim");
    const rows = z.array(claimedSchema).max(1).safeParse(data);
    if (!rows.success) throw new LeadDistributionRepositoryError("claim");
    const row = rows.data[0];
    if (!row) return null;
    return {
      deliveryId: row.delivery_id,
      companyId: row.company_id,
      destination: row.destination,
      sourceLabel: row.source_label,
      attemptCount: row.attempt_count,
      lead: {
        id: row.lead_id, name: row.name, phone: row.phone, email: row.email,
        submittedAddress: row.submitted_address,
        sourceSystem: row.source_system,
        sourceSubmittedAt: row.source_submitted_at,
        clientIpAddress: row.source_ip_address,
        clientUserAgent: row.source_user_agent,
        trustedFormUrl: row.trustedform_url,
      },
    };
  }

  async complete(
    claimed: ClaimedLeadDistribution,
    result: LeadConduitResult,
  ): Promise<LeadDistributionCompletion> {
    const observedAt = this.now();
    const retryDelaySeconds = Math.min(900, 30 * (2 ** Math.max(0, claimed.attemptCount - 1)));
    const retryAt = new Date(observedAt.getTime() + retryDelaySeconds * 1000).toISOString();
    const {data, error} = await this.client.rpc("complete_lead_distribution_delivery", {
      p_delivery_id: claimed.deliveryId,
      p_status: result.status,
      p_external_id: result.externalId,
      p_outcome: result.status === "sent" ? "success" : result.status,
      p_last_error: result.reason,
      p_available_at: result.status === "retryable_failed" ? retryAt : null,
    });
    if (error) throw new LeadDistributionRepositoryError("complete");
    const rows = z.array(completionSchema).max(1).safeParse(data);
    const row = rows.success ? rows.data[0] : null;
    if (!row || row.id !== claimed.deliveryId) throw new LeadDistributionRepositoryError("complete");
    return row.status;
  }

  async listPending(companyId: string, limit: number) {
    const safeLimit = z.number().int().min(1).max(100).parse(limit);
    const {data, error} = await this.client.rpc("list_pending_lead_distribution_deliveries", {
      p_limit: safeLimit,
      p_company_id: companyId,
      p_now: this.now().toISOString(),
    });
    if (error) throw new LeadDistributionRepositoryError("listPending");
    const parsed = pendingSchema.safeParse(data);
    if (!parsed.success) throw new LeadDistributionRepositoryError("listPending");
    return parsed.data.map((row) => ({
      deliveryId: row.delivery_id,
      leadId: row.lead_id,
      destination: row.destination,
      sourceLabel: row.source_label,
    }));
  }
}
