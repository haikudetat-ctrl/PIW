"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  addOnKindSchema,
  defaultValidUntil,
  draftFromRateCard,
  measurementSourceSchema,
  pickProposalMeasurement,
  proposalTierKeySchema,
  shouldAdvanceToProposalSent,
  streetMatchesAddress,
  zipFromAddress,
} from "@/domain/proposals";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { writeAuditEntry } from "@/modules/audit/write-audit-entry";
import { changeLeadStage } from "@/modules/leads/change-lead-stage";

export type ProposalActionResult = { error: string } | { ok: true };

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: adminProfile } = await supabase
    .from("admin_profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!adminProfile) return null;
  return { supabase, user, companyId: adminProfile.company_id };
}

type Admin = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

// Roofr reports hang off JobNimbus jobs. Only a single job that shares the
// lead's street line and ZIP counts as a match.
async function findRoofrReports(admin: Admin, address: string) {
  const zip = zipFromAddress(address);
  if (!zip) return [];
  const { data: jobs, error: jobsError } = await admin.supabase
    .from("jn_jobs")
    .select("jnid, address_line1, zip")
    .eq("company_id", admin.companyId)
    .like("zip", `${zip}%`);
  if (jobsError) throw new Error("Failed to look up JobNimbus jobs");
  const matched = (jobs ?? []).filter((job) =>
    streetMatchesAddress({ jobStreet: job.address_line1, jobZip: job.zip, address }),
  );
  if (matched.length !== 1) return [];
  const { data: reports, error: reportsError } = await admin.supabase
    .from("jobnimbus_job_roof_measurements")
    .select("file_jnid, total_squares, predominant_pitch_12")
    .eq("company_id", admin.companyId)
    .eq("job_jnid", matched[0].jnid);
  if (reportsError) throw new Error("Failed to look up Roofr reports");
  return (reports ?? []).flatMap((report) =>
    report.file_jnid && report.total_squares
      ? [
          {
            fileJnid: report.file_jnid,
            totalSquares: Number(report.total_squares),
            pitch12: report.predominant_pitch_12 === null ? null : Number(report.predominant_pitch_12),
          },
        ]
      : [],
  );
}

async function nextVersion(admin: Admin, leadId: string) {
  const { data, error } = await admin.supabase
    .from("proposals")
    .select("version")
    .eq("company_id", admin.companyId)
    .eq("lead_id", leadId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Failed to read proposal versions");
  return (data?.version ?? 0) + 1;
}

// Inserts the options and add-ons; a failure removes the half-built proposal
// so a lead never shows a draft without its options.
async function insertChildren(
  admin: Admin,
  proposalId: string,
  options: Record<string, unknown>[],
  addOns: Record<string, unknown>[],
) {
  const scoped = <T extends Record<string, unknown>>(rows: T[]) =>
    rows.map((row) => ({ ...row, company_id: admin.companyId, proposal_id: proposalId }));
  const { error: optionsError } = await admin.supabase
    .from("proposal_options")
    .insert(scoped(options) as never);
  const { error: addOnsError } = optionsError || addOns.length === 0
    ? { error: optionsError }
    : await admin.supabase.from("proposal_add_ons").insert(scoped(addOns) as never);
  if (optionsError || addOnsError) {
    await admin.supabase.from("proposals").delete().eq("id", proposalId);
    throw new Error("Failed to create the proposal options");
  }
}

const manualSquaresSchema = z.coerce.number().positive().max(99_999_999.99);

export async function createProposal(leadId: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return;

  const { data: lead, error: leadError } = await admin.supabase
    .from("leads")
    .select("id, submitted_address")
    .eq("company_id", admin.companyId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error("Lead not found");

  const { data: rateCard, error: rateCardError } = await admin.supabase
    .from("roof_pricing_rate_cards")
    .select("id, version")
    .eq("company_id", admin.companyId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rateCardError) throw new Error("Failed to load the rate card");
  if (!rateCard) throw new Error("Activate a rate card before building proposals");

  const [{ data: tiers, error: tiersError }, { data: adjustments, error: adjustmentsError }, { data: estimate }] =
    await Promise.all([
      admin.supabase
        .from("roof_pricing_tiers")
        .select(
          "tier_key, display_order, customer_name, customer_description, warranty_summary, differentiators, low_cents_per_square, high_cents_per_square, product_line_id, catalog_product_lines(name, catalog_manufacturers(name))",
        )
        .eq("company_id", admin.companyId)
        .eq("rate_card_id", rateCard.id),
      admin.supabase
        .from("roof_pricing_adjustments")
        .select("adjustment_code, customer_label, customer_explanation, calculation_kind, low_value, high_value, display_order")
        .eq("company_id", admin.companyId)
        .eq("rate_card_id", rateCard.id)
        .eq("active", true),
      admin.supabase
        .from("roof_estimates")
        .select("id, status, roof_squares")
        .eq("company_id", admin.companyId)
        .eq("lead_id", leadId)
        .maybeSingle(),
    ]);
  if (tiersError || adjustmentsError) throw new Error("Failed to load the rate card");

  const draft = draftFromRateCard({
    tiers: (tiers ?? []).map((tier) => ({
      tierKey: proposalTierKeySchema.parse(tier.tier_key),
      displayOrder: tier.display_order,
      customerName: tier.customer_name,
      customerDescription: tier.customer_description,
      warrantySummary: tier.warranty_summary,
      differentiators: tier.differentiators,
      lowCentsPerSquare: tier.low_cents_per_square,
      highCentsPerSquare: tier.high_cents_per_square,
      productLineId: tier.product_line_id,
      productLineName: tier.catalog_product_lines?.name ?? null,
      manufacturerName: tier.catalog_product_lines?.catalog_manufacturers?.name ?? null,
    })),
    adjustments: (adjustments ?? []).map((adjustment) => ({
      adjustmentCode: adjustment.adjustment_code,
      customerLabel: adjustment.customer_label,
      customerExplanation: adjustment.customer_explanation,
      calculationKind: addOnKindSchema.parse(adjustment.calculation_kind),
      lowValue: Number(adjustment.low_value),
      highValue: Number(adjustment.high_value),
      displayOrder: adjustment.display_order,
    })),
  });

  const measured = pickProposalMeasurement({
    roofrReports: await findRoofrReports(admin, lead.submitted_address),
    estimate: estimate
      ? { id: estimate.id, status: estimate.status, roofSquares: estimate.roof_squares === null ? null : Number(estimate.roof_squares) }
      : null,
  });
  const manual = manualSquaresSchema.safeParse(formData.get("roofSquares"));
  const measurement =
    measured ??
    (manual.success
      ? { roofSquares: manual.data, measurementSource: "manual" as const, measurementRef: null, pitch12: null }
      : null);
  if (!measurement) throw new Error("Enter the roof squares to start a proposal");

  const { data: proposal, error: proposalError } = await admin.supabase
    .from("proposals")
    .insert({
      company_id: admin.companyId,
      lead_id: leadId,
      version: await nextVersion(admin, leadId),
      roof_squares: measurement.roofSquares,
      measurement_source: measurement.measurementSource,
      measurement_ref: measurement.measurementRef,
      pitch_12: measurement.pitch12,
      rate_card_id: rateCard.id,
      pricing_version: rateCard.version,
      valid_until: defaultValidUntil(new Date()),
      created_by: admin.user.id,
    })
    .select("id")
    .single();
  if (proposalError || !proposal) throw new Error("Failed to create the proposal");

  await insertChildren(admin, proposal.id, draft.options, draft.addOns);

  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}/proposals/${proposal.id}`);
}

const saveDraftSchema = z.object({
  roofSquares: z.number().positive().max(99_999_999.99),
  measurementSource: measurementSourceSchema,
  pitch12: z.number().min(0).max(30).nullable(),
  stories: z.number().int().min(1).max(6).nullable(),
  layersToRemove: z.number().int().min(0).max(4).nullable(),
  recommendedTier: proposalTierKeySchema,
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(4_000).nullable(),
  options: z
    .array(z.object({ tierKey: proposalTierKeySchema, pricePerSquareCents: z.number().int().positive() }))
    .max(3),
  addOns: z
    .array(
      z.object({
        id: z.string().uuid(),
        included: z.boolean(),
        quantity: z.number().min(0).max(99_999_999.99),
        unitValue: z.number().min(0).max(9_999_999_999.99),
      }),
    )
    .max(50),
});

export type SaveProposalDraftInput = z.infer<typeof saveDraftSchema>;

// Autosave for the builder: the whole draft is written each time. The
// snapshot triggers reject writes once the proposal has been sent.
export async function saveProposalDraft(
  leadId: string,
  proposalId: string,
  input: SaveProposalDraftInput,
): Promise<ProposalActionResult> {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the highlighted values" };
  const admin = await requireAdmin();
  if (!admin) return { error: "Sign in again to keep editing" };
  const draft = parsed.data;

  const { data: current } = await admin.supabase
    .from("proposals")
    .select("measurement_source, measurement_ref")
    .eq("company_id", admin.companyId)
    .eq("id", proposalId)
    .eq("status", "draft")
    .maybeSingle();
  if (!current) return { error: "This proposal was sent; revise it to make changes" };

  const { error } = await admin.supabase
    .from("proposals")
    .update({
      roof_squares: draft.roofSquares,
      measurement_source: draft.measurementSource,
      // A measurement typed in by hand no longer points at its report.
      measurement_ref: draft.measurementSource === current.measurement_source ? current.measurement_ref : null,
      pitch_12: draft.pitch12,
      stories: draft.stories,
      layers_to_remove: draft.layersToRemove,
      recommended_tier: draft.recommendedTier,
      valid_until: draft.validUntil,
      notes: draft.notes,
    })
    .eq("company_id", admin.companyId)
    .eq("id", proposalId);
  if (error) return { error: "Couldn't save the proposal" };

  const results = await Promise.all([
    ...draft.options.map((option) =>
      admin.supabase
        .from("proposal_options")
        .update({ price_per_square_cents: option.pricePerSquareCents })
        .eq("proposal_id", proposalId)
        .eq("tier_key", option.tierKey),
    ),
    ...draft.addOns.map((addOn) =>
      admin.supabase
        .from("proposal_add_ons")
        .update({ included: addOn.included, quantity: addOn.quantity, unit_value: addOn.unitValue })
        .eq("proposal_id", proposalId)
        .eq("id", addOn.id),
    ),
  ]);
  if (results.some((result) => result.error)) return { error: "Couldn't save the proposal" };

  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

// Marks the proposal sent, voids older sent versions, and moves the lead to
// Proposal sent on the pipeline.
export async function sendProposal(leadId: string, proposalId: string): Promise<ProposalActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Sign in again to send" };

  const { data: sent, error } = await admin.supabase
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("company_id", admin.companyId)
    .eq("lead_id", leadId)
    .eq("id", proposalId)
    .eq("status", "draft")
    .select("version")
    .maybeSingle();
  if (error || !sent) return { error: "This proposal can't be sent" };

  await admin.supabase
    .from("proposals")
    .update({ status: "void" })
    .eq("company_id", admin.companyId)
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .lt("version", sent.version);

  const { data: lead } = await admin.supabase
    .from("leads")
    .select("stage")
    .eq("company_id", admin.companyId)
    .eq("id", leadId)
    .maybeSingle();
  if (lead && shouldAdvanceToProposalSent(lead.stage)) {
    const service = createServiceClient();
    await changeLeadStage(
      { leadId, toStage: "proposal_sent" },
      {
        applyStageChange: async ({ leadId: id, toStage }) => {
          const { data, error: stageError } = await service.rpc("change_lead_stage", {
            p_company_id: admin.companyId,
            p_lead_id: id,
            p_to_stage: toStage,
            p_changed_by: admin.user.id,
            p_note: `Proposal v${sent.version} sent`,
          });
          if (stageError || !data?.[0]) throw new Error("Failed to change lead stage");
          return { fromStage: data[0].from_stage };
        },
        recordAuditEntry: async ({ leadId: id, fromStage, toStage }) => {
          await writeAuditEntry(
            {
              companyId: admin.companyId,
              actorId: admin.user.id,
              action: "lead.stage_changed",
              entityType: "lead",
              entityId: id,
              metadata: { fromStage, toStage, proposalId },
            },
            service,
          );
        },
      },
    );
  }

  revalidatePath("/pipeline");
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/proposals/${proposalId}`);
  return { ok: true };
}

// A sent proposal is frozen; changing it starts a new draft version with the
// same measurement, prices and add-ons.
export async function reviseProposal(leadId: string, proposalId: string) {
  const admin = await requireAdmin();
  if (!admin) return;

  const [{ data: source }, { data: options }, { data: addOns }] = await Promise.all([
    admin.supabase
      .from("proposals")
      .select(
        "roof_squares, measurement_source, measurement_ref, pitch_12, stories, layers_to_remove, rate_card_id, pricing_version, recommended_tier, notes",
      )
      .eq("company_id", admin.companyId)
      .eq("lead_id", leadId)
      .eq("id", proposalId)
      .maybeSingle(),
    admin.supabase
      .from("proposal_options")
      .select(
        "tier_key, display_order, product_line_id, manufacturer_name, product_line_name, customer_name, customer_description, warranty_summary, differentiators, price_per_square_cents",
      )
      .eq("proposal_id", proposalId),
    admin.supabase
      .from("proposal_add_ons")
      .select("adjustment_code, label, explanation, calculation_kind, unit_value, quantity, included, display_order")
      .eq("proposal_id", proposalId),
  ]);
  if (!source || !options) throw new Error("Proposal not found");

  const { data: proposal, error } = await admin.supabase
    .from("proposals")
    .insert({
      ...source,
      company_id: admin.companyId,
      lead_id: leadId,
      version: await nextVersion(admin, leadId),
      valid_until: defaultValidUntil(new Date()),
      created_by: admin.user.id,
    })
    .select("id")
    .single();
  if (error || !proposal) throw new Error("Failed to revise the proposal");

  await insertChildren(admin, proposal.id, options, addOns ?? []);

  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}/proposals/${proposal.id}`);
}

export async function setProposalOutcome(
  leadId: string,
  proposalId: string,
  outcome: "accepted" | "declined",
): Promise<ProposalActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Sign in again" };
  const { data, error } = await admin.supabase
    .from("proposals")
    .update({ status: outcome })
    .eq("company_id", admin.companyId)
    .eq("lead_id", leadId)
    .eq("id", proposalId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Only a sent proposal can be accepted or declined" };
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/leads/${leadId}/proposals/${proposalId}`);
  return { ok: true };
}
