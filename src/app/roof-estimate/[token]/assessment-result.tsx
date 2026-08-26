"use client";

import {useRef} from "react";
import Link from "next/link";
import {useGSAP} from "@gsap/react";
import gsap from "gsap";
import type {
  RoofAssessmentRecommendation,
  RoofAssessmentResponses,
} from "@/domain/roof-assessment";
import {getAssessmentResultCopy} from "./public-estimate-flow";
import "./assessment.css";

type AssessmentRange = {
  lowCents: number;
  highCents: number;
  roofSquares: number;
  source: "sample" | "google";
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function getProjectOutlook(
  responses: RoofAssessmentResponses,
  recommendation: RoofAssessmentRecommendation,
) {
  const urgentSignal = responses.reason === "active_leak" ||
    responses.conditionSignals.some((signal) => signal === "active_leak" || signal === "sagging");
  const timing = urgentSignal || responses.timeline === "asap"
    ? "Prompt professional review"
    : responses.timeline === "within_month"
      ? "Plan within the next month"
      : responses.timeline === "this_season"
        ? "Plan within this season"
        : "Monitor and plan deliberately";

  const direction = recommendation === "replacement_may_make_sense"
    ? "Compare replacement pricing with the cost of continued repairs."
    : recommendation === "professional_inspection"
      ? "Confirm the repairable areas and remaining roof service life."
      : "Start with targeted maintenance or repair before considering replacement.";

  const complexRoof = responses.complexityFeatures.includes("multiple_levels");
  const hasGarage = responses.complexityFeatures.includes("garage");
  const costFactors = complexRoof && hasGarage
    ? "Multiple roof levels and an attached garage may affect access and material quantities."
    : complexRoof
      ? "Multiple roof levels may affect access, labor, and material quantities."
      : hasGarage
        ? "The attached garage may add roof area and transition details to the project."
        : responses.stories === "three_plus"
          ? "Building height may affect access and labor planning."
          : "Field conditions, tear-off layers, and decking remain the main unknowns.";

  return {timing, direction, costFactors};
}

export function AssessmentResult({
  address,
  imageUrl,
  recommendation,
  responses,
  range,
  consultationHref,
  onReplay,
}: {
  address: string;
  imageUrl: string;
  recommendation: RoofAssessmentRecommendation;
  responses: RoofAssessmentResponses;
  range: AssessmentRange | null;
  consultationHref: string;
  onReplay?: () => void;
}) {
  const copy = getAssessmentResultCopy(recommendation);
  const outlook = getProjectOutlook(responses, recommendation);
  const resultRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timeline = gsap.timeline({defaults: {ease: "power3.out"}});
    timeline
      .fromTo(".assessment-result-image", {scale: 0.96, opacity: 0.58}, {scale: 1, opacity: 1, duration: 0.9})
      .fromTo(".assessment-result-copy > *", {y: 14, opacity: 0}, {y: 0, opacity: 1, duration: 0.45, stagger: 0.045}, "-=0.58");
  }, {scope: resultRef});

  return (
    <main ref={resultRef} className="assessment-flow min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="assessment-nav flex items-center justify-between border-b border-slate-300/80 pb-5">
          <div>
            <p className="text-xs font-black tracking-[0.2em]">ALL SEASON</p>
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Personalized RoofCheck</p>
          </div>
          <span className="text-xs font-bold text-slate-500">Assessment complete</span>
        </header>

        <section className="py-9 sm:py-12">
          <div className="assessment-result-card grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,42,55,0.13)] lg:grid-cols-[minmax(0,0.88fr)_minmax(30rem,1.12fr)]">
            <div className="assessment-result-visual relative min-h-[22rem] bg-[#102f3d] sm:min-h-[30rem] lg:min-h-[44rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={`Aerial view of ${address}`} className="assessment-result-image absolute inset-0 size-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
                <p className="text-lg font-semibold tracking-[-0.02em]">{address}</p>
                <Link href="/roof-estimate" className="mt-3 inline-flex text-xs font-semibold text-white/70 underline decoration-white/30 underline-offset-4 hover:text-white">
                  Not your property? Update the address
                </Link>
              </div>
            </div>

            <div className="assessment-result-copy p-6 sm:p-9 lg:p-11">
              <h1 className="assessment-display w-full max-w-5xl text-[clamp(3.2rem,5vw,5.5rem)] leading-[0.92] tracking-[0.01em]">{copy.headline}</h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">{copy.body}</p>

              <div className="assessment-range-panel mt-8 rounded-2xl bg-[#0a2634] p-6 text-white sm:p-7">
                {range ? (
                  <>
                    <p className="text-sm font-semibold text-white/65">Preliminary project range</p>
                    <p className="mt-3 flex flex-wrap items-baseline gap-x-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
                      <span>{money.format(range.lowCents / 100)}</span>
                      <span className="text-2xl text-white/45">to</span>
                      <span>{money.format(range.highCents / 100)}</span>
                    </p>
                    <p className="mt-4 text-xs leading-5 text-white/60">
                      {range.source === "sample"
                        ? "Sample range for this development preview"
                        : `Based on approximately ${range.roofSquares.toFixed(1)} measured roofing squares`}
                    </p>
                  </>
                ) : (
                  <div aria-live="polite">
                    <p className="text-lg font-semibold">Finalizing your property calculation</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/65">Your outlook is ready. The measured range will appear here when the property calculation finishes.</p>
                    <div className="mt-6 h-10 w-3/4 animate-pulse rounded-lg bg-white/10 motion-reduce:animate-none" aria-hidden="true" />
                  </div>
                )}
              </div>

              <div className="mt-8 grid gap-7 sm:grid-cols-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-500">Recommended timing</h2>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.025em]">{outlook.timing}</p>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-500">Likely direction</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{outlook.direction}</p>
                </div>
                <div className="sm:col-span-2 sm:border-t sm:border-slate-200 sm:pt-6">
                  <h2 className="text-sm font-semibold text-slate-500">What may shape the project</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{outlook.costFactors}</p>
                </div>
              </div>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href={consultationHref}
                  aria-describedby="assessment-consultation-note"
                  className="assessment-conversion-action rounded-xl bg-slate-950 px-6 py-4 text-center text-sm font-black text-white transition hover:bg-slate-800 active:-translate-y-px"
                >
                  {copy.cta}
                </a>
                {onReplay ? (
                  <button type="button" onClick={onReplay} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-500 transition hover:text-slate-900">
                    Replay assessment
                  </button>
                ) : null}
              </div>
              <p id="assessment-consultation-note" className="mt-4 max-w-xl text-xs leading-5 text-slate-500">
                A roofing specialist will review the property details and your priorities before recommending a scope.
              </p>
              <p className="mt-5 text-xs leading-5 text-slate-500">Preliminary planning guidance only. A field inspection confirms scope, materials, and final pricing.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
