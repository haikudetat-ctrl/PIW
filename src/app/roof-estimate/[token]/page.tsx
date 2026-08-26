import { notFound } from "next/navigation";
import { z } from "zod";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { getRoofAssessmentContext } from "@/config/roof-assessment";
import { roofAssessmentProgressSchema, roofAssessmentResponsesSchema } from "@/domain/roof-assessment";
import { parseServerEnv } from "@/lib/env/server";
import { createServiceClient } from "@/lib/supabase/service";
import { AssessmentExperience } from "./assessment-experience";
import { AssessmentQuestionnaire } from "./assessment-questionnaire";
import { AssessmentResult } from "./assessment-result";
import { EstimateStatusRefresh } from "./estimate-status-refresh";
import { EstimateWaitExperience } from "./estimate-wait-experience";
import { PropertySatelliteImage } from "./property-satellite-image";
import { getAssessmentCalculationState, getAssessmentResultCopy, selectPublicEstimateView } from "./public-estimate-flow";
import { QuoteLoadingView } from "./quote-loading-view";
import { ResumeRequiredView } from "./resume-required-view";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function PropertyMedia({ token, address }: { token: string; address: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-[0_28px_80px_rgba(15,42,74,0.2)]">
      <div className="relative aspect-[4/3] min-h-[22rem] lg:min-h-[34rem]">
        <PropertySatelliteImage
          src={`/api/roof-estimate/${token}/house-image`}
          address={address}
        />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/70 to-transparent" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-xs text-slate-300">
        <span>{address}</span>
        <span translate="no">Satellite imagery from Google Maps</span>
      </div>
    </div>
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
    .select("id, status, range_low_cents, range_high_cents, roof_squares, roof_insight_id, updated_at, failure_reason, lead_id, property_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) notFound();

  const [{ data: pipeline }, { data: property }, { data: lead }, { data: assessment }] = await Promise.all([
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
    service
      .from("roof_assessments")
      .select("status, revision, current_step, property_revealed_at, responses, recommendation, presentation_key")
      .eq("estimate_id", estimate.id)
      .maybeSingle(),
  ]);

  const pipelineTerminal = Boolean(
    pipeline && ["complete", "partial", "review_required", "failed"].includes(pipeline.status),
  );
  const pending = estimate.status === "pending" && !pipelineTerminal;
  const manualReview =
    estimate.status === "review_required" ||
    (estimate.status === "pending" && pipeline?.status === "review_required");
  const calculation = getAssessmentCalculationState({
    estimateStatus: estimate.status,
    pipelineStatus: pipeline?.status ?? null,
    sourceId: estimate.roof_insight_id,
    lowCents: estimate.range_low_cents,
    highCents: estimate.range_high_cents,
    roofSquares: estimate.roof_squares === null ? null : Number(estimate.roof_squares),
    generatedAt: estimate.updated_at,
  });
  const ready = calculation.status === "ready";
  const address = property?.canonical_address ?? lead?.submitted_address ?? "your property";
  const assessmentStatus = z.enum(["in_progress", "abandoned", "completed"]).safeParse(assessment?.status);
  const assessmentRecommendation = z.enum([
    "monitor_or_repair",
    "professional_inspection",
    "replacement_may_make_sense",
  ]).safeParse(assessment?.recommendation);
  const completedAssessmentResponses = roofAssessmentResponsesSchema.safeParse(assessment?.responses);
  const view = selectPublicEstimateView({
    assessmentEnabled: parseServerEnv(process.env).ROOF_ASSESSMENT_ENABLED,
    assessmentStatus: assessmentStatus.success ? assessmentStatus.data : null,
  });
  const assessmentCopy = view === "result" && assessmentRecommendation.success
    ? getAssessmentResultCopy(assessmentRecommendation.data)
    : null;

  if (view === "resume_required") {
    return <ResumeRequiredView />;
  }

  if (view === "assessment") {
    const assessmentResponses = roofAssessmentProgressSchema.safeParse(assessment?.responses);
    return (
      <AssessmentExperience
        token={token}
        address={address}
        imageUrl={`/api/roof-estimate/${token}/house-image`}
        context={getRoofAssessmentContext(lead?.campaign)}
        initialPropertyRevealed={Boolean(assessment?.property_revealed_at)}
        initialStep={assessment?.current_step ?? 0}
        initialRevision={assessment?.revision ?? 0}
      >
        <AssessmentQuestionnaire
          token={token}
          address={address}
          imageUrl={`/api/roof-estimate/${token}/house-image`}
          initialStep={assessment?.current_step ?? 0}
          initialResponses={assessmentResponses.success ? assessmentResponses.data : {}}
        />
      </AssessmentExperience>
    );
  }

  if (
    view === "result" &&
    assessmentRecommendation.success &&
    completedAssessmentResponses.success
  ) {
    return (
      <>
        <EstimateStatusRefresh pending={pending} />
        <AssessmentResult
          token={token}
          address={address}
          imageUrl={`/api/roof-estimate/${token}/house-image`}
          recommendation={assessmentRecommendation.data}
          responses={completedAssessmentResponses.data}
          calculation={calculation}
          context={getRoofAssessmentContext(assessment?.presentation_key ?? lead?.campaign)}
        />
      </>
    );
  }

  if (pending && view === "legacy") {
    return (
      <>
        <EstimateStatusRefresh pending />
        <QuoteLoadingView brand={roofEstimateBrand} address={address} />
      </>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#eef3f5] px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100 sm:px-6 sm:py-10">
      <EstimateStatusRefresh pending={pending} />
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex items-center justify-between gap-4 sm:mb-10">
          <div>
            <p className="text-sm font-bold tracking-tight">{roofEstimateBrand.name}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">New Jersey roofing specialists</p>
          </div>
          <a
            href={roofEstimateBrand.phoneHref}
            className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:border-slate-500 active:translate-y-px dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {roofEstimateBrand.phoneDisplay}
          </a>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.18fr)_minmax(24rem,0.82fr)] lg:items-stretch">
          <PropertyMedia token={token} address={address} />

          <div className="estimate-reveal flex min-h-[34rem] flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,42,74,0.08)] dark:border-slate-800 dark:bg-slate-900 sm:p-9 lg:p-10">
            {manualReview ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  {assessmentCopy?.eyebrow ?? "Professional review"}
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  {assessmentCopy?.headline ?? "We are checking the property match."}
                </h1>
                <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
                  {assessmentCopy?.body ?? "Google did not return a measurement we trust enough to price automatically. Your request is saved for a roofing professional."}
                </p>
                <EstimateWaitExperience brand={roofEstimateBrand} manualReview />
              </>
            ) : ready ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  {assessmentCopy?.eyebrow ?? "Preliminary roof estimate"}
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  {assessmentCopy?.headline ?? "Your range is ready."}
                </h1>
                <p className="mt-8 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white sm:text-5xl">
                  {money.format(estimate.range_low_cents! / 100)} <span className="text-slate-400">to</span> {money.format(estimate.range_high_cents! / 100)}
                </p>
                <p className="mt-5 max-w-md text-base leading-7 text-slate-600 dark:text-slate-300">
                  Based on approximately {Number(estimate.roof_squares).toFixed(1)} roofing squares and current New Jersey architectural-shingle averages.
                </p>

                <dl className="mt-8 grid grid-cols-2 gap-5 rounded-2xl bg-slate-100 p-5 dark:bg-slate-800/70">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Measured roof</dt>
                    <dd className="mt-1 text-lg font-semibold">{Number(estimate.roof_squares).toFixed(1)} squares</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Pricing market</dt>
                    <dd className="mt-1 text-lg font-semibold">New Jersey</dd>
                  </div>
                </dl>

                <a
                  href={roofEstimateBrand.phoneHref}
                  className="mt-7 w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-center text-sm font-bold text-white transition hover:bg-slate-800 active:translate-y-px dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"
                >
                  {assessmentCopy?.cta ?? "Talk with a roofing specialist"}
                </a>
                <p className="mt-5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field conditions can change the final proposal.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  {assessmentCopy?.eyebrow ?? "Request received"}
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  {assessmentCopy?.headline ?? "Your request is with our team."}
                </h1>
                <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
                  {assessmentCopy?.body ?? "We could not create a reliable instant range. A roofing professional can review the property and follow up."}
                </p>
                {assessmentCopy ? (
                  <a
                    href={roofEstimateBrand.phoneHref}
                    className="mt-7 w-full rounded-2xl bg-slate-950 px-5 py-3.5 text-center text-sm font-bold text-white transition hover:bg-slate-800 active:translate-y-px dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"
                  >
                    {assessmentCopy.cta}
                  </a>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
