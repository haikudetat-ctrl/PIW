"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RoofAssessmentContext } from "@/config/roof-assessment";
import {loadAssessmentAerial} from "./assessment-aerial-loader";
import { AssessmentLoading } from "./assessment-loading";
import { AssessmentRevisionContext } from "./assessment-revision-context";
import "./assessment.css";

type ExperienceStage = "loading" | "reveal" | "questions";
type AerialState =
  | {source: string; kind: "loading" | "waiting" | "unavailable"; objectUrl: null}
  | {source: string; kind: "ready"; objectUrl: string};

export const REVEAL_RETRY_MS = 2_500;
export const MAX_REVEAL_RETRIES = 36;

function withAerialRetry(url: string, attempt: number) {
  if (attempt === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}aerial_retry=${attempt}`;
}

function useAssessmentAerial({
  aerialLoader,
  enabled,
  imageUrl,
  stage,
}: {
  aerialLoader: typeof loadAssessmentAerial;
  enabled: boolean;
  imageUrl: string;
  stage: ExperienceStage;
}) {
  const [storedAerial, setAerial] = useState<AerialState>({
    source: imageUrl,
    kind: "loading",
    objectUrl: null,
  });
  const aerial = storedAerial.source === imageUrl
    ? storedAerial
    : {source: imageUrl, kind: "loading", objectUrl: null} as const;
  const objectUrl = useRef<string | null>(null);
  const stageRef = useRef(stage);
  const rebaseRetryForReveal = useRef<(() => void) | null>(null);

  useEffect(() => {
    stageRef.current = stage;
    if (stage === "reveal") rebaseRetryForReveal.current?.();
  }, [stage]);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    let attempt = 0;
    let revealRetries = 0;
    let retryTimer: number | undefined;
    let controller: AbortController | undefined;

    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    const requestAerial = async () => {
      if (stageRef.current === "reveal" && attempt > 0) {
        if (revealRetries >= MAX_REVEAL_RETRIES) return;
        revealRetries += 1;
      }
      controller = new AbortController();

      try {
        const result = await aerialLoader({
          imageSrc: withAerialRetry(imageUrl, attempt),
          signal: controller.signal,
        });
        if (!active) {
          if (result.kind === "ready") URL.revokeObjectURL(result.objectUrl);
          return;
        }

        if (result.kind === "ready") {
          if (objectUrl.current && objectUrl.current !== result.objectUrl) {
            URL.revokeObjectURL(objectUrl.current);
          }
          objectUrl.current = result.objectUrl;
          setAerial({source: imageUrl, kind: "ready", objectUrl: result.objectUrl});
          return;
        }

        if (result.kind === "unavailable") {
          setAerial({source: imageUrl, kind: "unavailable", objectUrl: null});
          return;
        }

        setAerial({source: imageUrl, kind: "waiting", objectUrl: null});
        const revealed = stageRef.current === "reveal";
        const delay = revealed ? REVEAL_RETRY_MS : result.delayMs;
        const retry = () => {
          retryTimer = undefined;
          rebaseRetryForReveal.current = null;
          attempt += 1;
          void requestAerial();
        };
        retryTimer = window.setTimeout(retry, delay);
        rebaseRetryForReveal.current = revealed ? null : () => {
          if (!active || retryTimer === undefined) return;
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(retry, REVEAL_RETRY_MS);
          rebaseRetryForReveal.current = null;
        };
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setAerial({source: imageUrl, kind: "unavailable", objectUrl: null});
      }
    };

    void requestAerial();

    return () => {
      active = false;
      controller?.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      rebaseRetryForReveal.current = null;
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
  }, [aerialLoader, enabled, imageUrl]);

  return aerial;
}

export function AssessmentExperience({
  aerialLoader = loadAssessmentAerial,
  preview = false,
  token,
  address,
  imageUrl,
  context,
  initialPropertyRevealed,
  initialStep,
  initialRevision = 0,
  children,
}: {
  aerialLoader?: typeof loadAssessmentAerial;
  preview?: boolean;
  token: string;
  address: string;
  imageUrl: string;
  context: RoofAssessmentContext;
  initialPropertyRevealed: boolean;
  initialStep: number;
  initialRevision?: number;
  children: ReactNode;
}) {
  const [stage, setStage] = useState<ExperienceStage>(
    initialStep > 0 ? "questions" : initialPropertyRevealed ? "reveal" : "loading",
  );
  const aerial = useAssessmentAerial({
    aerialLoader,
    enabled: stage !== "questions",
    imageUrl,
    stage,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [revision, setRevision] = useState(initialRevision);
  const revealRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (stage !== "reveal" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timeline = gsap.timeline({defaults: {ease: "power3.out"}});
    timeline
      .fromTo(".assessment-reveal-copy > *", {y: 16, opacity: 0}, {y: 0, opacity: 1, duration: 0.46, stagger: 0.055});
  }, {scope: revealRef, dependencies: [stage]});

  if (stage === "loading") {
    return (
      <AssessmentLoading
        address={address}
        imageSrc={imageUrl}
        imageObjectUrl={aerial.objectUrl}
        stages={context.loadingStages}
        onReady={({durationMs, outcome}) => {
          setStage("reveal");
          if (!preview) {
            void fetch(`/api/roof-estimate/${token}/analysis-event`, {
              method: "POST",
              headers: {"content-type": "application/json"},
              body: JSON.stringify({durationMs, outcome}),
              keepalive: true,
            }).catch(() => undefined);
          }
        }}
      />
    );
  }

  if (stage === "questions") {
    return <AssessmentRevisionContext value={revision}>{children}</AssessmentRevisionContext>;
  }

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
      body: JSON.stringify({
        expectedRevision: revision,
        questionId: null,
        propertyRevealed: true,
        responsePatch: {},
      }),
    }).catch(() => null);

    if (!response?.ok) {
      setSaving(false);
      setSaveError(true);
      return;
    }
    const canonical = await response.json().catch(() => null) as {revision?: number} | null;
    if (typeof canonical?.revision === "number") setRevision(canonical.revision);
    setStage("questions");
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  return (
    <main ref={revealRef} className={`assessment-flow assessment-reveal-shell ${context.accentClass} min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8`}>
      <div className="assessment-reveal-frame mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col">
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

        <div className="assessment-reveal-stage my-auto py-6 lg:py-10">
          <section
            aria-label="Confirmed property assessment"
            className="assessment-reveal-card grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,42,55,0.16)] lg:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]"
          >
          <div className="assessment-reveal-visual relative min-h-[23rem] overflow-hidden bg-[#102f3d] sm:min-h-[32rem] lg:min-h-[39rem]">
            {aerial.kind === "ready" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="assessment-aerial-image"
                src={aerial.objectUrl}
                alt={`Aerial view of ${address}`}
                className="assessment-reveal-aerial absolute inset-0 size-full object-cover"
              />
            ) : (
              <div className="assessment-imagery-pending absolute inset-0 grid place-items-center px-6">
                <div role="status" aria-live="polite" className="assessment-imagery-status max-w-xs text-center">
                  <p className="text-sm font-bold text-white">Finalizing your property imagery</p>
                  <p className="mt-2 text-xs leading-5 text-white/68">Your assessment is ready while the aerial view is prepared.</p>
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/15" />
            <div className="assessment-reveal-address absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-white/60">
                {aerial.kind === "ready" ? "Confirmed property" : "Property location"}
              </p>
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
            <div
              role="group"
              aria-label="Confirmed property summary"
              className="assessment-confirmation-summary"
            >
              <p className="assessment-context-kicker text-xs font-black uppercase tracking-[0.19em]">
                {context.kicker}
              </p>
              <h1 className="assessment-display w-full max-w-5xl text-[clamp(3.4rem,6vw,5.8rem)] leading-[0.9] tracking-[0.01em]">
                Property confirmed.
              </h1>
              <p className="text-xl font-semibold tracking-[-0.025em] text-slate-800">
                {context.headline}
              </p>
            </div>
            <p className="assessment-reveal-intro mt-4 max-w-lg text-base leading-7 text-slate-600">
              {context.intro}
            </p>
            <div className="assessment-reveal-next mt-8 border-y border-slate-200 py-5">
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
