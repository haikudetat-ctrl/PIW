import { notFound } from "next/navigation";
import { z } from "zod";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { createServiceClient } from "@/lib/supabase/service";
import { CampaignEstimateShell } from "./campaign-estimate-shell";
import {
  buildEstimateResultModel,
  type EstimateResultModel,
} from "./estimate-result-model";
import { EstimateStatusRefresh } from "./estimate-status-refresh";
import { EstimateWaitExperience } from "./estimate-wait-experience";
import { PropertySatelliteImage } from "./property-satellite-image";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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

function ManualReviewContent({ model }: { model: EstimateResultModel }) {
  return (
    <>
      <p className="campaign-estimate-kicker">{model.copy.eyebrow}</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.copy.headline}
      </h1>
      <p className="campaign-estimate-intro">
        Your request is saved. Our team is making sure the estimate starts with the right roof.
      </p>
      <EstimateWaitExperience theme={model.theme} manualReview />
    </>
  );
}

function ReadyContent({ model }: { model: EstimateResultModel }) {
  return (
    <>
      <p className="campaign-estimate-kicker">{model.copy.eyebrow}</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.copy.headline}
      </h1>
      <p className="campaign-estimate-amount">
        {money.format(model.rangeLowCents! / 100)} <span>to</span>{" "}
        {money.format(model.rangeHighCents! / 100)}
      </p>
      <p className="campaign-estimate-intro">{model.copy.description}</p>

      <dl className="campaign-estimate-facts">
        <div>
          <dt>Measured roof</dt>
          <dd>{Number(model.roofSquares).toFixed(1)} squares</dd>
        </div>
        <div>
          <dt>Pricing market</dt>
          <dd>New Jersey</dd>
        </div>
      </dl>

      <a href={roofEstimateBrand.phoneHref} className="campaign-primary-action">
        Talk with a roofing specialist
      </a>
      <p className="campaign-estimate-disclaimer">
        Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field
        conditions can change the final proposal.
      </p>
    </>
  );
}

function UnavailableContent({ model }: { model: EstimateResultModel }) {
  return (
    <>
      <p className="campaign-estimate-kicker">{model.copy.eyebrow}</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.copy.headline}
      </h1>
      <p className="campaign-estimate-intro">{model.copy.description}</p>
      <a href={roofEstimateBrand.phoneHref} className="campaign-primary-action">
        Call {roofEstimateBrand.phoneDisplay}
      </a>
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

  const result = buildEstimateResultModel({
    estimate,
    pipelineStatus: pipeline?.status,
    canonicalAddress: property?.canonical_address,
    submittedAddress: lead?.submitted_address,
    campaign: lead?.campaign,
  });
  const pending = result.state === "processing";

  return (
    <>
      <EstimateStatusRefresh pending={pending} />
      <CampaignEstimateShell
        theme={result.theme}
        propertyMedia={
          pending ? (
            <PropertyMediaSkeleton address={result.address} />
          ) : (
            <PropertyMedia token={token} address={result.address} />
          )
        }
      >
        {pending ? (
          <ProcessingContent model={result} />
        ) : result.state === "manual-review" ? (
          <ManualReviewContent model={result} />
        ) : result.state === "ready" ? (
          <ReadyContent model={result} />
        ) : (
          <UnavailableContent model={result} />
        )}
      </CampaignEstimateShell>
    </>
  );
}
