import { notFound } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { CampaignEstimateShell } from "./campaign-estimate-shell";
import { CampaignResultContent } from "./campaign-result-content";
import {
  buildEstimateResultModel,
  type EstimateResultModel,
} from "./estimate-result-model";
import { EstimateStatusRefresh } from "./estimate-status-refresh";
import { EstimateWaitExperience } from "./estimate-wait-experience";
import { PropertySatelliteImage } from "./property-satellite-image";

function PropertyMedia({ token, address }: { token: string; address: string }) {
  return (
    <figure className="campaign-property-frame">
      <div className="campaign-property-visual">
        <PropertySatelliteImage
          src={`/api/roof-estimate/${token}/house-image`}
          address={address}
        />
        <div className="campaign-property-scrim" aria-hidden="true" />
      </div>
      <figcaption className="campaign-property-caption">
        <span className="campaign-property-address">{address}</span>
        <span>Satellite view</span>
      </figcaption>
    </figure>
  );
}

function PropertyMediaSkeleton({ address }: { address: string }) {
  return (
    <figure className="campaign-property-frame">
      <div className="campaign-property-visual estimate-map-skeleton">
        <div className="estimate-scan" aria-hidden="true" />
        <div className="campaign-property-overlay">
          <p className="campaign-property-media-heading">Preparing the property view</p>
          <p>
            Matching the submitted address to the correct property and roof.
          </p>
        </div>
      </div>
      <figcaption className="campaign-property-caption">
        <span className="campaign-property-address">{address}</span>
        <span>Property match in progress</span>
      </figcaption>
    </figure>
  );
}

function ProcessingContent({ model }: { model: EstimateResultModel }) {
  return (
    <>
      <p className="campaign-estimate-kicker">Request accepted</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.theme.loadingStatement}
      </h1>
      <p className="campaign-estimate-intro">
        We are confirming the property before we prepare your roof estimate.
      </p>
      <EstimateWaitExperience theme={model.theme} />
    </>
  );
}

export default async function RoofEstimateResultPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();

  const service = createServiceClient();
  const { data: estimate } = await service
    .from("roof_estimates")
    .select("status, range_low_cents, range_high_cents, roof_squares, failure_reason, lead_id, property_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) notFound();

  const [{ data: pipeline }, { data: property }, { data: lead }] = await Promise.all([
    service
      .from("pipeline_runs")
      .select("status")
      .eq("lead_id", estimate.lead_id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("properties")
      .select("canonical_address")
      .eq("id", estimate.property_id)
      .maybeSingle(),
    service
      .from("leads")
      .select("submitted_address, campaign")
      .eq("id", estimate.lead_id)
      .maybeSingle(),
  ]);

  const model = buildEstimateResultModel({
    estimate,
    pipelineStatus: pipeline?.status,
    canonicalAddress: property?.canonical_address,
    submittedAddress: lead?.submitted_address,
    campaign: lead?.campaign,
  });
  const pending = model.state === "processing";

  return (
    <>
      <EstimateStatusRefresh pending={pending} />
      <CampaignEstimateShell
        theme={model.theme}
        propertyMedia={
          pending ? (
            <PropertyMediaSkeleton address={model.address} />
          ) : (
            <PropertyMedia token={token} address={model.address} />
          )
        }
      >
        {pending ? (
          <ProcessingContent model={model} />
        ) : (
          <CampaignResultContent model={model} />
        )}
      </CampaignEstimateShell>
    </>
  );
}
