"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RoofAssessmentContext } from "@/config/roof-assessment";
import { AssessmentLoading } from "./assessment-loading";
import "./assessment.css";

type ExperienceStage = "loading" | "reveal" | "questions";

export function AssessmentExperience({
  preview = false,
  token,
  address,
  imageUrl,
  context,
  initialPropertyRevealed,
  initialStep,
  children,
}: {
  preview?: boolean;
  token: string;
  address: string;
  imageUrl: string;
  context: RoofAssessmentContext;
  initialPropertyRevealed: boolean;
  initialStep: number;
  children: ReactNode;
}) {
  const [stage, setStage] = useState<ExperienceStage>(
    initialStep > 0 ? "questions" : initialPropertyRevealed ? "reveal" : "loading",
  );
  const [imageAvailable, setImageAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const revealRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (stage !== "reveal" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timeline = gsap.timeline({defaults: {ease: "power3.out"}});
    timeline
      .fromTo(".assessment-reveal-visual img", {scale: 0.96, opacity: 0.5}, {scale: 1, opacity: 1, duration: 0.9})
      .fromTo(".assessment-reveal-copy > *", {y: 16, opacity: 0}, {y: 0, opacity: 1, duration: 0.46, stagger: 0.055}, "-=0.55");
  }, {scope: revealRef, dependencies: [stage]});

  if (stage === "loading") {
    return (
      <AssessmentLoading
        address={address}
        imageSrc={imageUrl}
        stages={context.loadingStages}
        onReady={({imageAvailable: available}) => {
          setImageAvailable(available);
          setStage("reveal");
        }}
      />
    );
  }

  if (stage === "questions") return <>{children}</>;

  async function startAssessment() {
    if (saving) return;
    if (preview) {
      setStage("questions");
      window.scrollTo({top: 0, behavior: "smooth"});
      return;
    }
    setSaving(true);
    setSaveError(false);
    const response = await fetch(`/api/roof-estimate/${token}/assessment`, {
      method: "PATCH",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({currentStep: 0, propertyRevealed: true, responses: {}}),
    }).catch(() => null);

    if (!response?.ok) {
      setSaving(false);
      setSaveError(true);
      return;
    }
    setStage("questions");
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  return (
    <main ref={revealRef} className={`assessment-flow assessment-reveal-shell ${context.accentClass} min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8`}>
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col">
        <header className="assessment-nav flex items-center justify-between border-b border-slate-300/80 pb-5">
          <div>
            <p className="text-xs font-black tracking-[0.2em] text-slate-900">ALL SEASON</p>
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">
              Personalized RoofCheck
            </p>
          </div>
          <span className="rounded-full border border-slate-300 bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600">
            Property confirmed
          </span>
        </header>

        <div className="my-auto py-6 lg:py-10">
          <section
            aria-label="Confirmed property assessment"
            className="assessment-reveal-card grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,42,55,0.16)] lg:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]"
          >
          <div className="assessment-reveal-visual relative min-h-[23rem] overflow-hidden bg-[#102f3d] sm:min-h-[32rem] lg:min-h-[39rem]">
            {imageAvailable ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={`Aerial view of ${address}`}
                onError={() => setImageAvailable(false)}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={context.fallbackImage}
                alt="All Season roofing assessment"
                className="absolute inset-0 size-full object-cover opacity-70"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/15" />
            <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-white/60">Confirmed property</p>
              <p className="mt-2 max-w-2xl text-lg font-semibold tracking-[-0.02em] sm:text-xl">{address}</p>
              <Link
                href="/roof-estimate"
                className="mt-3 inline-flex text-xs font-semibold text-white/70 underline decoration-white/30 underline-offset-4 transition hover:text-white hover:decoration-white/70"
              >
                Not your property? Update the address
              </Link>
            </div>
          </div>

          <div className="assessment-reveal-copy flex flex-col justify-center border-t border-slate-200 bg-white p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
            <p className="assessment-context-kicker text-xs font-black uppercase tracking-[0.19em]">
              {context.kicker}
            </p>
            <h1 className="assessment-display mt-5 w-full max-w-5xl text-[clamp(3.4rem,6vw,5.8rem)] leading-[0.9] tracking-[0.01em]">
              Property confirmed.
            </h1>
            <p className="mt-5 text-xl font-semibold tracking-[-0.025em] text-slate-800">
              {context.headline}
            </p>
            <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">
              {context.intro}
            </p>
            <div className="mt-8 border-y border-slate-200 py-5">
              <p className="text-sm font-semibold text-slate-800">Next: a few questions about what you have noticed.</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">No measurements or roofing knowledge needed.</p>
            </div>
            {saveError ? (
              <p role="alert" className="mt-5 text-sm font-semibold text-red-700">
                We could not save your progress. Your property is still confirmed.
              </p>
            ) : null}
            <button
              type="button"
              onClick={startAssessment}
              disabled={saving}
              className="assessment-primary-action mt-7 w-full rounded-xl bg-slate-950 px-5 py-4 text-sm font-black text-white transition hover:bg-slate-800 active:translate-y-px disabled:cursor-wait disabled:opacity-65"
            >
              {saving ? "Saving your property…" : saveError ? "Try again" : "Start my assessment"}
            </button>
          </div>
          </section>
        </div>
      </div>
    </main>
  );
}
