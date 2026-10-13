import Link from "next/link";
import { notFound } from "next/navigation";
import { addOnKindSchema, measurementSourceSchema, proposalStatusSchema, proposalTierKeySchema } from "@/domain/proposals";
import { createServerClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/icons";
import { ProposalBuilder, type BuilderProposal } from "./proposal-builder";

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ leadId: string; proposalId: string }>;
}) {
  const { leadId, proposalId } = await params;
  const supabase = await createServerClient();

  const [{ data: proposal, error }, { data: options }, { data: addOns }, { data: lead }] = await Promise.all([
    supabase
      .from("proposals")
      .select(
        "id, company_id, lead_id, version, status, roof_squares, measurement_source, pitch_12, stories, layers_to_remove, recommended_tier, valid_until, notes, sent_at, updated_at",
      )
      .eq("id", proposalId)
      .eq("lead_id", leadId)
      .maybeSingle(),
    supabase
      .from("proposal_options")
      .select(
        "tier_key, display_order, manufacturer_name, product_line_name, customer_name, customer_description, warranty_summary, price_per_square_cents",
      )
      .eq("proposal_id", proposalId)
      .order("display_order"),
    supabase
      .from("proposal_add_ons")
      .select("id, label, explanation, calculation_kind, unit_value, quantity, included, display_order")
      .eq("proposal_id", proposalId)
      .order("display_order"),
    supabase.from("leads").select("id, name").eq("id", leadId).maybeSingle(),
  ]);
  if (error) throw new Error("Failed to load proposal");
  if (!proposal || !lead) notFound();

  const { data: estimate } = await supabase
    .from("roof_estimates")
    .select("status, roof_squares, range_low_cents, range_high_cents")
    .eq("company_id", proposal.company_id)
    .eq("lead_id", leadId)
    .maybeSingle();

  const builderProposal: BuilderProposal = {
    id: proposal.id,
    version: proposal.version,
    status: proposalStatusSchema.parse(proposal.status),
    roofSquares: Number(proposal.roof_squares),
    measurementSource: measurementSourceSchema.parse(proposal.measurement_source),
    pitch12: proposal.pitch_12 === null ? null : Number(proposal.pitch_12),
    stories: proposal.stories,
    layersToRemove: proposal.layers_to_remove,
    recommendedTier: proposalTierKeySchema.parse(proposal.recommended_tier),
    validUntil: proposal.valid_until,
    notes: proposal.notes,
    sentAt: proposal.sent_at,
    options: (options ?? []).map((option) => ({
      tierKey: proposalTierKeySchema.parse(option.tier_key),
      manufacturerName: option.manufacturer_name,
      productLineName: option.product_line_name,
      customerName: option.customer_name,
      customerDescription: option.customer_description,
      warrantySummary: option.warranty_summary,
      pricePerSquareCents: option.price_per_square_cents,
    })),
    addOns: (addOns ?? []).map((addOn) => ({
      id: addOn.id,
      label: addOn.label,
      explanation: addOn.explanation,
      calculationKind: addOnKindSchema.parse(addOn.calculation_kind),
      unitValue: Number(addOn.unit_value),
      quantity: Number(addOn.quantity),
      included: addOn.included,
    })),
  };

  const preliminary =
    estimate?.status === "ready" && estimate.range_low_cents !== null && estimate.range_high_cents !== null
      ? {
          lowCents: estimate.range_low_cents,
          highCents: estimate.range_high_cents,
          roofSquares: estimate.roof_squares === null ? null : Number(estimate.roof_squares),
        }
      : null;

  return (
    <main className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px]">
        <Link href="/pipeline" className="text-tint hover:underline">Pipeline</Link>
        <Icon name="chevronRight" size={14} className="text-ink-subtle" />
        <Link href={`/leads/${leadId}`} className="text-tint hover:underline">{lead.name}</Link>
        <Icon name="chevronRight" size={14} className="text-ink-subtle" />
        <span className="text-ink-muted">Proposal</span>
      </nav>
      <ProposalBuilder
        leadId={leadId}
        customerName={lead.name}
        proposal={builderProposal}
        preliminary={preliminary}
      />
    </main>
  );
}
