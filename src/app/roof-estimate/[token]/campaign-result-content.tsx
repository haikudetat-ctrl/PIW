import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import type { EstimateResultModel } from "./estimate-result-model";

const wholeDollar = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const proofPoints = [
  "Serving New Jersey since 2009",
  "No installation subcontractors",
  "Long-term workmanship and system coverage",
] as const;

function CampaignTrust({ model }: { model: EstimateResultModel }) {
  return (
    <section className="campaign-result-trust" aria-labelledby="campaign-trust-heading">
      <p className="campaign-result-trust-kicker">Why homeowners choose All Season</p>
      <h2 id="campaign-trust-heading" className="campaign-result-trust-heading">
        {model.theme.trustHeadline}
      </h2>
      <p className="campaign-result-trust-copy">{model.theme.trustCopy}</p>
      <ul className="campaign-result-proof" aria-label="All Season roofing commitments">
        {proofPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </section>
  );
}

function ReadyResult({ model }: { model: EstimateResultModel }) {
  const range = `${wholeDollar.format(model.rangeLowCents! / 100)} to ${wholeDollar.format(
    model.rangeHighCents! / 100,
  )}`;

  return (
    <>
      <p className="campaign-estimate-kicker">{model.copy.eyebrow}</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.copy.headline}
      </h1>
      <p className="campaign-estimate-amount">{range}</p>
      <p className="campaign-estimate-intro">{model.copy.description}</p>

      <dl className="campaign-estimate-facts">
        <div>
          <dt>Estimated roof size</dt>
          <dd>
            {model.roofSquares === null
              ? "Measurement reviewed"
              : `${model.roofSquares.toFixed(1)} squares`}
          </dd>
        </div>
        <div>
          <dt>Pricing context</dt>
          <dd>New Jersey architectural shingles</dd>
        </div>
      </dl>

      <p className="campaign-estimate-disclaimer campaign-estimate-disclaimer--prominent">
        This preliminary estimate is an initial planning range, not a final contract price.
        Roof condition, decking, flashing, access, ventilation, and selected materials may
        affect the final scope and proposal.
      </p>
      <a href={roofEstimateBrand.phoneHref} className="campaign-primary-action">
        Schedule the roof inspection
      </a>
      <p className="campaign-estimate-phone-fallback">
        Prefer to talk it through?{" "}
        <a href={roofEstimateBrand.phoneHref}>{roofEstimateBrand.phoneDisplay}</a>
      </p>

      <CampaignTrust model={model} />
    </>
  );
}

function NonReadyResult({ model }: { model: EstimateResultModel }) {
  const description =
    model.state === "manual-review"
      ? "Your request is saved. A roofing professional is checking the property match before preparing a reliable estimate."
      : "We could not create a reliable instant range. Your request is saved with our roofing team for a professional review.";

  return (
    <>
      <p className="campaign-estimate-kicker">{model.copy.eyebrow}</p>
      <h1 id="estimate-heading" className="campaign-estimate-title">
        {model.copy.headline}
      </h1>
      <p className="campaign-estimate-intro">{description}</p>
      <a href={roofEstimateBrand.phoneHref} className="campaign-primary-action">
        Call {roofEstimateBrand.phoneDisplay}
      </a>
      <CampaignTrust model={model} />
    </>
  );
}

export function CampaignResultContent({ model }: { model: EstimateResultModel }) {
  return model.state === "ready" ? (
    <ReadyResult model={model} />
  ) : (
    <NonReadyResult model={model} />
  );
}
