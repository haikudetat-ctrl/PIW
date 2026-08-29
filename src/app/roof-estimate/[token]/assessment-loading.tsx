"use client";

import { useEffect, useRef, useState } from "react";
import type {AssessmentAnalysisOutcome} from "@/modules/roof-assessment/analysis-telemetry";

export const MINIMUM_ANALYSIS_MS = 8_000;
export const AERIAL_HARD_CAP_MS = 12_000;

type LoadingTiming = {
  imageSrc: string;
  activeStage: number;
  minimumElapsed: boolean;
  imageTimeoutElapsed: boolean;
};

function initialTiming(imageSrc: string): LoadingTiming {
  return {imageSrc, activeStage: 0, minimumElapsed: false, imageTimeoutElapsed: false};
}

export function AssessmentLoading({
  address,
  imageSrc,
  imageObjectUrl,
  stages,
  minimumDurationMs = MINIMUM_ANALYSIS_MS,
  imageTimeoutMs = AERIAL_HARD_CAP_MS,
  onReady,
}: {
  address: string;
  imageSrc: string;
  imageObjectUrl: string | null;
  stages: readonly string[];
  minimumDurationMs?: number;
  imageTimeoutMs?: number;
  onReady: (result: {
    durationMs: number;
    imageAvailable: boolean;
    outcome: AssessmentAnalysisOutcome;
  }) => void;
}) {
  const [storedTiming, setTiming] = useState<LoadingTiming>(() => initialTiming(imageSrc));
  const timing = storedTiming.imageSrc === imageSrc ? storedTiming : initialTiming(imageSrc);
  const completed = useRef(false);
  const startedAt = useRef(0);
  const imageReadyBeforeMinimum = useRef(false);

  useEffect(() => {
    completed.current = false;
    startedAt.current = Date.now();
    imageReadyBeforeMinimum.current = false;
    const stageDuration = minimumDurationMs / stages.length;
    const stageTimer = window.setInterval(() => {
      setTiming((current) => ({
        ...(current.imageSrc === imageSrc ? current : initialTiming(imageSrc)),
        activeStage: Math.min(
          (current.imageSrc === imageSrc ? current.activeStage : 0) + 1,
          stages.length - 1,
        ),
      }));
    }, stageDuration);
    const minimumTimer = window.setTimeout(() => setTiming((current) => ({
      ...(current.imageSrc === imageSrc ? current : initialTiming(imageSrc)),
      minimumElapsed: true,
    })), minimumDurationMs);
    const imageTimer = window.setTimeout(() => setTiming((current) => ({
      ...(current.imageSrc === imageSrc ? current : initialTiming(imageSrc)),
      imageTimeoutElapsed: true,
    })), imageTimeoutMs);

    return () => {
      window.clearInterval(stageTimer);
      window.clearTimeout(minimumTimer);
      window.clearTimeout(imageTimer);
    };
  }, [imageSrc, imageTimeoutMs, minimumDurationMs, stages.length]);

  useEffect(() => {
    if (imageObjectUrl && !timing.minimumElapsed) {
      imageReadyBeforeMinimum.current = true;
    }
    if (
      completed.current ||
      (!timing.imageTimeoutElapsed && (!timing.minimumElapsed || !imageObjectUrl))
    ) return;
    completed.current = true;
    const imageAvailable = Boolean(imageObjectUrl);
    const outcome: AssessmentAnalysisOutcome = !imageAvailable || timing.imageTimeoutElapsed
      ? "pending_at_12s"
      : imageReadyBeforeMinimum.current
        ? "ready_at_8s"
        : "ready_between_8s_12s";
    onReady({
      durationMs: Math.max(0, Date.now() - startedAt.current),
      imageAvailable,
      outcome,
    });
  }, [imageObjectUrl, onReady, timing.imageTimeoutElapsed, timing.minimumElapsed]);

  const activeLabel = stages[timing.activeStage] ?? "Preparing the assessment";

  return (
    <main className="assessment-flow assessment-analysis-shell min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#071f2e] text-white">
      <div className="assessment-analysis-image" aria-hidden="true">
        <div className="assessment-analysis-grid" />
      </div>
      {imageObjectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageObjectUrl}
          alt={`Aerial view loading for ${address}`}
          className="assessment-analysis-aerial is-ready"
        />
      ) : null}
      <div className="assessment-analysis-scrim" />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="assessment-nav assessment-nav-dark flex items-center justify-between border-b border-white/15 pb-5">
          <div>
            <p className="text-xs font-black tracking-[0.2em]">ALL SEASON</p>
            <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/55">
              Personalized RoofCheck
            </p>
          </div>
          <span className="text-xs font-semibold text-white/60">Property analysis</span>
        </header>

        <section className="my-auto grid gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)] lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
              Building your personalized roof assessment
            </p>
            <h1 className="assessment-display mt-5 w-full max-w-6xl text-[clamp(4rem,8vw,8rem)] leading-[0.86] tracking-[0.01em]">
              Analyzing your property.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/68 sm:text-lg">
              We are matching <span className="font-semibold text-white">{address}</span> with the property information available for your roof.
            </p>
          </div>

          <div className="assessment-stage-card border border-white/15 bg-slate-950/45 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="mb-5 flex items-center justify-between">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-white/50">
                Analysis in progress
              </span>
              <span className="assessment-stage-pulse" aria-hidden="true" />
            </div>
            <div className="assessment-stage-window" aria-hidden="true">
              <div
                className="assessment-stage-rail"
                style={{transform: `translateY(-${timing.activeStage * 3.25}rem)`}}
              >
                {stages.map((stage, index) => (
                  <div
                    className="assessment-stage-row"
                    data-active={index === timing.activeStage}
                    data-complete={index < timing.activeStage}
                    key={stage}
                  >
                    <span>{index < timing.activeStage ? "✓" : String(index + 1).padStart(2, "0")}</span>
                    <strong>{stage}</strong>
                  </div>
                ))}
              </div>
            </div>
            <p role="status" aria-live="polite" className="sr-only">{activeLabel}</p>
            <div className="mt-6 h-px overflow-hidden bg-white/10">
              <span className="assessment-progress-line block h-full bg-lime-300" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
