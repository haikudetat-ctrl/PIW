"use client";

import { useState, type ReactNode } from "react";
import type { RoofAssessmentContext } from "@/config/roof-assessment";
import { AssessmentLoading } from "./assessment-loading";

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
  }

  return (
    <main className={`assessment-reveal-shell ${context.accentClass} min-h-[100dvh] bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8`}>
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col">
        <header className="flex items-center justify-between border-b border-slate-300/80 pb-5">
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

        <section className="my-auto grid gap-5 py-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)] lg:gap-0 lg:py-10">
          <div className="assessment-reveal-media relative min-h-[23rem] overflow-hidden bg-[#102f3d] shadow-[0_28px_90px_rgba(15,42,55,0.2)] sm:min-h-[32rem] lg:min-h-[39rem]">
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
            </div>
          </div>

          <div className="assessment-reveal-panel flex flex-col justify-center border border-slate-200 bg-white p-7 shadow-[0_24px_70px_rgba(15,42,55,0.1)] sm:p-10 lg:my-10 lg:border-l-0 lg:p-12">
            <p className="assessment-context-kicker text-xs font-black uppercase tracking-[0.19em]">
              {context.kicker}
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              We found your property.
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
    </main>
  );
}
