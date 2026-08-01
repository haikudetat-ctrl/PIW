import { notFound } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { roofEstimateBrand } from "@/config/roof-estimate-brand";
import { EstimateStatusRefresh } from "./estimate-status-refresh";
import { EstimateWaitExperience } from "./estimate-wait-experience";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function RoofEstimateResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();
  const service = createServiceClient();
  const { data: estimate } = await service
    .from("roof_estimates")
    .select("status, range_low_cents, range_high_cents, roof_squares, failure_reason, lead_id")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) notFound();
  const { data: pipeline } = await service
    .from("pipeline_runs")
    .select("status")
    .eq("lead_id", estimate.lead_id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pipelineTerminal = pipeline && ["complete", "partial", "review_required", "failed"].includes(pipeline.status);
  const pending = estimate.status === "pending" && !pipelineTerminal;
  const manualReview =
    estimate.status === "review_required" ||
    (estimate.status === "pending" && pipeline?.status === "review_required");
  const ready = estimate.status === "ready" && estimate.range_low_cents !== null && estimate.range_high_cents !== null;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <EstimateStatusRefresh pending={pending} />
      <section className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-7 text-center shadow-[0_24px_70px_rgba(15,42,74,0.1)] sm:p-10">
        <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase">Your roof estimate</p>
        {pending ? (
          <><h1 className="mt-4 text-3xl font-bold">We’re measuring the roof.</h1><p className="mt-3 text-ink-muted">Keep your phone nearby—our team has your request and may call while Google prepares the measurement.</p><div className="mx-auto mt-6 size-8 animate-spin rounded-full border-4 border-border border-t-accent" aria-label="Estimate processing" /><EstimateWaitExperience brand={roofEstimateBrand} /></>
        ) : manualReview ? (
          <><h1 className="mt-4 text-3xl font-bold">A roofing professional is checking the match.</h1><p className="mt-3 text-ink-muted">Google did not return a measurement we trust enough to price automatically. Your request is saved and the team can follow up using the contact details you provided.</p><EstimateWaitExperience brand={roofEstimateBrand} manualReview /></>
        ) : ready ? (
          <><h1 className="mt-4 text-3xl font-bold">Your preliminary range</h1><p className="mt-6 text-4xl font-bold tracking-tight text-accent sm:text-5xl">{money.format(estimate.range_low_cents! / 100)}–{money.format(estimate.range_high_cents! / 100)}</p><p className="mt-4 text-sm text-ink-muted">Based on approximately {Number(estimate.roof_squares).toFixed(1)} roofing squares at current New Jersey architectural-shingle averages.</p><p className="mt-2 text-xs text-ink-subtle" translate="no">Includes data from Google Maps</p><div className="mt-8 rounded-lg bg-warning-bg p-4 text-left text-sm leading-6 text-warning">Preliminary sales estimate—not a final quote. Decking, tear-off layers, access, permits, and field-verified complexity can change the final proposal.</div><p className="mt-6 text-sm text-ink-muted">We’ve queued this result for delivery by both SMS and email.</p></>
        ) : (
          <><h1 className="mt-4 text-3xl font-bold">Your request is with our team.</h1><p className="mt-4 text-ink-muted">We couldn’t create a reliable automated range for this property. A roofing professional can review it and follow up using the contact details you provided.</p></>
        )}
      </section>
    </main>
  );
}
