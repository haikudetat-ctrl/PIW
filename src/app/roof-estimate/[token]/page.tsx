import { notFound } from "next/navigation";
import { z } from "zod";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { createServiceClient } from "@/lib/supabase/service";
import { buildEstimateResultModel } from "./estimate-result-model";
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

function PropertyMediaSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-[0_28px_80px_rgba(15,42,74,0.2)]">
      <div className="estimate-map-skeleton relative aspect-[4/3] min-h-[22rem] lg:min-h-[34rem]">
        <div className="estimate-scan absolute inset-x-0 top-0 h-px bg-cyan-200/80 shadow-[0_0_22px_rgba(165,243,252,0.75)]" />
        <div className="absolute inset-x-4 bottom-5 rounded-2xl border border-white/10 bg-slate-950/55 p-4 backdrop-blur-md sm:inset-x-8 sm:bottom-8 sm:p-5">
          <p className="text-sm font-semibold text-white">Preparing the property view</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
            Google is matching the address to the correct building and roof planes.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 px-5 py-4 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span>Property match in progress</span>
        <span>Usually ready in under a minute</span>
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
  const manualReview = result.state === "manual-review";
  const ready = result.state === "ready";

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
          {ready || manualReview ? (
            <PropertyMedia token={token} address={result.address} />
          ) : (
            <PropertyMediaSkeleton />
          )}

          <div className="estimate-reveal flex min-h-[34rem] flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,42,74,0.08)] dark:border-slate-800 dark:bg-slate-900 sm:p-9 lg:p-10">
            {pending ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  Measurement in progress
                </p>
                <h1 className="mt-5 max-w-lg text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  Your roof is being measured.
                </h1>
                <p className="mt-5 max-w-md text-base leading-7 text-slate-600 dark:text-slate-300">
                  Keep your phone close. Our team may call while Google prepares the measurement.
                </p>
                <EstimateWaitExperience brand={roofEstimateBrand} />
              </>
            ) : manualReview ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  Professional review
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  We are checking the property match.
                </h1>
                <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
                  Google did not return a measurement we trust enough to price automatically. Your request is saved for a roofing professional.
                </p>
                <EstimateWaitExperience brand={roofEstimateBrand} manualReview />
              </>
            ) : ready ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  Preliminary roof estimate
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  Your range is ready.
                </h1>
                <p className="mt-8 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-white sm:text-5xl">
                  {money.format(result.rangeLowCents! / 100)} <span className="text-slate-400">to</span> {money.format(result.rangeHighCents! / 100)}
                </p>
                <p className="mt-5 max-w-md text-base leading-7 text-slate-600 dark:text-slate-300">
                  Based on approximately {Number(result.roofSquares).toFixed(1)} roofing squares and current New Jersey architectural-shingle averages.
                </p>

                <dl className="mt-8 grid grid-cols-2 gap-5 rounded-2xl bg-slate-100 p-5 dark:bg-slate-800/70">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Measured roof</dt>
                    <dd className="mt-1 text-lg font-semibold">{Number(result.roofSquares).toFixed(1)} squares</dd>
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
                  Talk with a roofing specialist
                </a>
                <p className="mt-5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Preliminary sales estimate only. Decking, tear-off layers, access, permits, and field conditions can change the final proposal.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                  Request received
                </p>
                <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  Your request is with our team.
                </h1>
                <p className="mt-5 text-base leading-7 text-slate-600 dark:text-slate-300">
                  We could not create a reliable instant range. A roofing professional can review the property and follow up.
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
