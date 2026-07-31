import { notFound } from "next/navigation";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { EstimateStatusRefresh } from "./estimate-status-refresh";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function RoofEstimateResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();
  const { data: estimate } = await createServiceClient()
    .from("roof_estimates")
    .select("status, range_low_cents, range_high_cents, roof_squares, failure_reason")
    .eq("public_token", token)
    .maybeSingle();
  if (!estimate) notFound();
  const pending = estimate.status === "pending";
  const ready = estimate.status === "ready" && estimate.range_low_cents !== null && estimate.range_high_cents !== null;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <EstimateStatusRefresh pending={pending} />
      <section className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-7 text-center shadow-[0_24px_70px_rgba(15,42,74,0.1)] sm:p-10">
        <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase">Your roof estimate</p>
        {pending ? (
          <><h1 className="mt-4 text-3xl font-bold">We’re measuring the roof.</h1><p className="mt-3 text-ink-muted">Google is matching the building and calculating its roof planes. This page will update automatically.</p><div className="mx-auto mt-8 size-10 animate-spin rounded-full border-4 border-border border-t-accent" aria-label="Estimate processing" /></>
        ) : ready ? (
          <><h1 className="mt-4 text-3xl font-bold">Your preliminary range</h1><p className="mt-6 text-4xl font-bold tracking-tight text-accent sm:text-5xl">{money.format(estimate.range_low_cents! / 100)}–{money.format(estimate.range_high_cents! / 100)}</p><p className="mt-4 text-sm text-ink-muted">Based on approximately {Number(estimate.roof_squares).toFixed(1)} roofing squares at current New Jersey architectural-shingle averages.</p><div className="mt-8 rounded-lg bg-warning-bg p-4 text-left text-sm leading-6 text-warning">Preliminary sales estimate—not a final quote. Decking, tear-off layers, access, permits, and field-verified complexity can change the final proposal.</div><p className="mt-6 text-sm text-ink-muted">We’ve queued this result for delivery by both SMS and email.</p></>
        ) : (
          <><h1 className="mt-4 text-3xl font-bold">Your request is with our team.</h1><p className="mt-4 text-ink-muted">We couldn’t create a reliable automated range for this property. A roofing professional can review it and follow up using the contact details you provided.</p></>
        )}
      </section>
    </main>
  );
}
