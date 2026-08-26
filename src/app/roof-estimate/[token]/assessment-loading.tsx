"use client";

import { useEffect, useRef, useState } from "react";

export function AssessmentLoading({
  address,
  imageSrc,
  stages,
  minimumDurationMs = 5_000,
  imageTimeoutMs = 12_000,
  onReady,
}: {
  address: string;
  imageSrc: string;
  stages: readonly string[];
  minimumDurationMs?: number;
  imageTimeoutMs?: number;
  onReady: (result: {imageAvailable: boolean}) => void;
}) {
  const [activeStage, setActiveStage] = useState(0);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [imageState, setImageState] = useState<"pending" | "available" | "unavailable">("pending");
  const completed = useRef(false);

  useEffect(() => {
    const stageDuration = minimumDurationMs / stages.length;
    const stageTimer = window.setInterval(() => {
      setActiveStage((current) => Math.min(current + 1, stages.length - 1));
    }, stageDuration);
    const minimumTimer = window.setTimeout(() => setMinimumElapsed(true), minimumDurationMs);
    const imageTimer = window.setTimeout(() => {
      setImageState((current) => current === "pending" ? "unavailable" : current);
    }, imageTimeoutMs);

    return () => {
      window.clearInterval(stageTimer);
      window.clearTimeout(minimumTimer);
      window.clearTimeout(imageTimer);
    };
  }, [imageTimeoutMs, minimumDurationMs, stages.length]);

  useEffect(() => {
    if (!minimumElapsed || imageState === "pending" || completed.current) return;
    completed.current = true;
    onReady({imageAvailable: imageState === "available"});
  }, [imageState, minimumElapsed, onReady]);

  const activeLabel = stages[activeStage] ?? "Preparing the assessment";

  return (
    <main className="assessment-flow assessment-analysis-shell min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#071f2e] text-white">
      <div className="assessment-analysis-image" aria-hidden="true">
        <div className="assessment-analysis-grid" />
      </div>
      {/* The browser reuses this image response from cache for the reveal. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={`Aerial view loading for ${address}`}
        onLoad={() => setImageState("available")}
        onError={() => setImageState("unavailable")}
        className={`assessment-analysis-aerial ${imageState === "available" ? "is-ready" : ""}`}
      />
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
                style={{transform: `translateY(-${activeStage * 3.25}rem)`}}
              >
                {stages.map((stage, index) => (
                  <div
                    className="assessment-stage-row"
                    data-active={index === activeStage}
                    data-complete={index < activeStage}
                    key={stage}
                  >
                    <span>{index < activeStage ? "✓" : String(index + 1).padStart(2, "0")}</span>
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
