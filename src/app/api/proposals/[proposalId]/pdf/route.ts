import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { addOnKindSchema, measurementSourceSchema, proposalTierKeySchema } from "@/domain/proposals";
import { createServerClient } from "@/lib/supabase/server";
import { ProposalDocument, type ProposalDocumentProps } from "@/modules/proposals/proposal-document";

export const runtime = "nodejs";
export const maxDuration = 60;

// Signed-in preview of a proposal. Reads through the user's session, so row
// level security decides who can see it; there is no public PDF route.
export async function GET(_request: Request, ctx: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await ctx.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "id, company_id, lead_id, version, status, roof_squares, measurement_source, pitch_12, recommended_tier, valid_until, created_at, sent_at",
    )
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [{ data: options }, { data: addOns }, { data: lead }, { data: company }] = await Promise.all([
    supabase
      .from("proposal_options")
      .select(
        "tier_key, customer_name, manufacturer_name, product_line_name, customer_description, warranty_summary, differentiators, price_per_square_cents",
      )
      .eq("proposal_id", proposalId)
      .order("display_order"),
    supabase
      .from("proposal_add_ons")
      .select("label, explanation, calculation_kind, unit_value, quantity")
      .eq("proposal_id", proposalId)
      .eq("included", true)
      .order("display_order"),
    supabase
      .from("leads")
      .select("name, submitted_address, properties(canonical_address)")
      .eq("company_id", proposal.company_id)
      .eq("id", proposal.lead_id)
      .maybeSingle(),
    supabase.from("companies").select("name").eq("id", proposal.company_id).maybeSingle(),
  ]);
  if (!options || options.length === 0 || !lead) {
    return NextResponse.json({ error: "proposal unavailable" }, { status: 404 });
  }

  const props: ProposalDocumentProps = {
    companyName: company?.name ?? "Your roofing contractor",
    proposalNumber: `${proposal.id.slice(0, 8).toUpperCase()}-v${proposal.version}`,
    issuedOn: new Date(proposal.sent_at ?? proposal.created_at),
    validUntil: proposal.valid_until,
    status: proposal.status,
    customerName: lead.name,
    propertyAddress: lead.properties?.canonical_address ?? lead.submitted_address,
    roofSquares: Number(proposal.roof_squares),
    measurementSource: measurementSourceSchema.parse(proposal.measurement_source),
    pitch12: proposal.pitch_12 === null ? null : Number(proposal.pitch_12),
    recommendedTier: proposalTierKeySchema.parse(proposal.recommended_tier),
    options: options.map((option) => ({
      tierKey: proposalTierKeySchema.parse(option.tier_key),
      customerName: option.customer_name,
      manufacturerName: option.manufacturer_name,
      productLineName: option.product_line_name,
      customerDescription: option.customer_description,
      warrantySummary: option.warranty_summary,
      differentiators: Array.isArray(option.differentiators)
        ? option.differentiators.filter((item): item is string => typeof item === "string")
        : [],
      pricePerSquareCents: option.price_per_square_cents,
    })),
    addOns: (addOns ?? []).map((addOn) => ({
      label: addOn.label,
      explanation: addOn.explanation,
      calculationKind: addOnKindSchema.parse(addOn.calculation_kind),
      unitValue: Number(addOn.unit_value),
      quantity: Number(addOn.quantity),
    })),
  };

  const pdf = await renderToBuffer(
    createElement(ProposalDocument, props) as Parameters<typeof renderToBuffer>[0],
  );
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="proposal-${props.proposalNumber}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
