"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { RoofAssessmentResponses } from "@/domain/roof-assessment";
import {
  assessmentQuestionTitles,
  complexityOptions,
  conditionOptions,
  ownershipOptions,
  priorityOptions,
  reasonOptions,
  roofAgeOptions,
  storyOptions,
  timelineOptions,
  type AssessmentOption,
} from "./assessment-questions";

type Responses = Partial<RoofAssessmentResponses>;

const progressNarratives = [
  "Understanding what brought you here",
  "Establishing the roof's age",
  "Reviewing visible symptoms",
  "Checking what can be seen safely",
  "Mapping the property profile",
  "Accounting for roof sections",
  "Understanding your priorities",
  "Planning the right timing",
  "Confirming your relationship to the property",
] as const;

function OptionGrid({
  options,
  selected,
  onSelect,
  multi = false,
}: {
  options: AssessmentOption[];
  selected: string[];
  onSelect: (value: string) => void;
  multi?: boolean;
}) {
  return (
    <div className="assessment-option-grid" data-multi={multi}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            type="button"
            key={option.value}
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className="assessment-option"
          >
            <span className="assessment-option-marker" aria-hidden="true">{active ? "✓" : ""}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function educationalCopy(step: number, responses: Responses) {
  if (step === 0 && responses.reason === "active_leak") {
    return "A leak doesn't automatically mean you need a full replacement. We'll factor urgency into the assessment.";
  }
  if (step === 0 && responses.reason === "roof_age") {
    return "Roof age helps us compare the economics of repair and replacement.";
  }
  if (step === 1 && responses.roofAge === "unknown") {
    return "Totally fine. Most homeowners don't know. We'll estimate where possible.";
  }
  if (step === 2 && responses.conditionSignals?.length) {
    return "Those symptoms can point to different problems. We'll use them without assuming replacement is necessary.";
  }
  if (step === 3 && responses.roofVisible === "no") {
    return "No problem. Don't climb on the roof. We'll work with what we have.";
  }
  if (step === 6 && responses.priority) {
    return "We'll tailor the recommendation around that.";
  }
  return null;
}

export function AssessmentQuestionnaire({
  preview = false,
  onPreviewComplete,
  token,
  address,
  imageUrl,
  initialStep,
  initialResponses,
}: {
  preview?: boolean;
  onPreviewComplete?: (responses: Responses) => void;
  token: string;
  address?: string;
  imageUrl?: string;
  initialStep: number;
  initialResponses: Responses;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), 8));
  const [responses, setResponses] = useState<Responses>(initialResponses);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const shellRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timeline = gsap.timeline({defaults: {ease: "power3.out"}});
    timeline
      .fromTo(".assessment-question-panel h1", {y: 16}, {y: 0, duration: 0.42})
      .fromTo(
        ".assessment-option",
        {y: 10},
        {y: 0, duration: 0.36, stagger: 0.025},
        "-=0.24",
      );
  }, {scope: shellRef, dependencies: [step]});

  function selectSingle<Key extends keyof RoofAssessmentResponses>(
    key: Key,
    value: RoofAssessmentResponses[Key],
  ) {
    setError("");
    setResponses((current) => ({...current, [key]: value}));
  }

  function toggleMulti(
    key: "conditionSignals" | "complexityFeatures",
    value: string,
    exclusiveValues: string[],
  ) {
    setError("");
    setResponses((current) => {
      const selected = (current[key] ?? []) as string[];
      const next = exclusiveValues.includes(value)
        ? (selected.includes(value) ? [] : [value])
        : selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected.filter((item) => !exclusiveValues.includes(item)), value];
      return {...current, [key]: next};
    });
  }

  function answered() {
    switch (step) {
      case 0: return Boolean(responses.reason);
      case 1: return Boolean(responses.roofAge);
      case 2: return Boolean(responses.conditionSignals?.length);
      case 3:
        return responses.roofVisible === "no" ||
          (responses.roofVisible === "yes" && Boolean(responses.visibleCondition));
      case 4: return Boolean(responses.stories);
      case 5: return Boolean(responses.complexityFeatures?.length);
      case 6: return Boolean(responses.priority);
      case 7: return Boolean(responses.timeline);
      case 8: return Boolean(responses.ownership);
      default: return false;
    }
  }

  async function continueAssessment() {
    if (!answered() || saving) return;
    if (preview) {
      if (step === 8) onPreviewComplete?.(responses);
      else {
        setStep((current) => current + 1);
        window.scrollTo({top: 0, behavior: "smooth"});
      }
      return;
    }
    setSaving(true);
    setError("");
    const completing = step === 8;
    const response = await fetch(`/api/roof-estimate/${token}/assessment`, {
      method: completing ? "POST" : "PATCH",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(completing
        ? responses
        : {currentStep: step + 1, responses}),
    }).catch(() => null);

    if (!response?.ok) {
      setSaving(false);
      setError("We could not save your answer. Check your connection and try again.");
      return;
    }
    if (completing) {
      router.refresh();
      return;
    }
    setStep((current) => current + 1);
    window.scrollTo({top: 0, behavior: "smooth"});
    setSaving(false);
  }

  const message = educationalCopy(step, responses);
  const progressNarrative = progressNarratives[step];

  return (
    <main ref={shellRef} className="assessment-flow assessment-question-shell min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8">
      <div className="assessment-question-frame mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-6xl flex-col">
        <header className="assessment-nav flex items-center justify-between border-b border-slate-300/80 pb-5">
          <div>
            <p className="text-xs font-black tracking-[0.2em]">ALL SEASON</p>
            <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Personalized RoofCheck</p>
          </div>
          <p className="text-xs font-bold text-slate-500">Building your assessment</p>
        </header>

        <div
          role="progressbar"
          aria-label="Roof assessment progress"
          aria-valuemin={1}
          aria-valuemax={9}
          aria-valuenow={step + 1}
          aria-valuetext={`${progressNarrative}, ${step + 1} of 9`}
          className="assessment-progress-track mt-5 h-1 overflow-hidden bg-slate-200"
        >
          <span className="block h-full rounded-full bg-slate-950 transition-[width] duration-500" style={{width: `${((step + 1) / 9) * 100}%`}} />
        </div>

        <section className="assessment-question-stage my-auto grid grid-flow-dense gap-8 py-10 lg:grid-cols-[minmax(17rem,0.42fr)_minmax(0,1fr)] lg:gap-16 lg:py-14">
          <aside className="assessment-question-aside block">
            {address && imageUrl ? (
              <div className="assessment-property-context overflow-hidden">
                <div className="group relative aspect-[4/3] overflow-hidden bg-[#12313d]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt={`Confirmed property at ${address}`}
                    className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 to-transparent" />
                  <p className="absolute inset-x-0 bottom-0 p-5 text-sm font-semibold leading-5 text-white">{address}</p>
                </div>
              </div>
            ) : null}
            <div className="mt-7 border-l-2 border-[#b7d532] pl-5">
              <p className="text-sm font-bold text-slate-900">Why we ask</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">Each answer helps separate what deserves attention now from what can be monitored or repaired deliberately.</p>
            </div>
          </aside>

          <div className="assessment-question-panel w-full max-w-4xl">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">{progressNarrative}</p>
              <p className="text-xs font-bold text-slate-400">{step + 1} of 9</p>
            </div>
            <h1 className="assessment-display mt-4 w-full max-w-5xl text-[clamp(2.8rem,6vw,5.3rem)] leading-[0.92] tracking-[0.01em]">{assessmentQuestionTitles[step]}</h1>
            <div className="assessment-answer-scroll mt-8">
              {step === 0 ? <OptionGrid options={reasonOptions} selected={responses.reason ? [responses.reason] : []} onSelect={(value) => selectSingle("reason", value as RoofAssessmentResponses["reason"])} /> : null}
              {step === 1 ? <OptionGrid options={roofAgeOptions} selected={responses.roofAge ? [responses.roofAge] : []} onSelect={(value) => selectSingle("roofAge", value as RoofAssessmentResponses["roofAge"])} /> : null}
              {step === 2 ? <OptionGrid multi options={conditionOptions} selected={responses.conditionSignals ?? []} onSelect={(value) => toggleMulti("conditionSignals", value, ["nothing_obvious", "unsure"])} /> : null}
              {step === 3 ? (
                <div className="space-y-6">
                  <OptionGrid options={[{value: "yes", label: "Yes"}, {value: "no", label: "No"}]} selected={responses.roofVisible ? [responses.roofVisible] : []} onSelect={(value) => {
                    selectSingle("roofVisible", value as RoofAssessmentResponses["roofVisible"]);
                    if (value === "no") selectSingle("visibleCondition", "not_answered");
                  }} />
                  {responses.roofVisible === "yes" ? (
                    <fieldset>
                      <legend className="mb-3 text-sm font-bold text-slate-700">Which looks closest from the ground?</legend>
                      <OptionGrid options={[{value: "healthy", label: "Looks healthy"}, {value: "moderate_wear", label: "Moderate wear"}, {value: "heavy_wear", label: "Heavy wear"}]} selected={responses.visibleCondition ? [responses.visibleCondition] : []} onSelect={(value) => selectSingle("visibleCondition", value as RoofAssessmentResponses["visibleCondition"])} />
                    </fieldset>
                  ) : null}
                </div>
              ) : null}
              {step === 4 ? <OptionGrid options={storyOptions} selected={responses.stories ? [responses.stories] : []} onSelect={(value) => selectSingle("stories", value as RoofAssessmentResponses["stories"])} /> : null}
              {step === 5 ? <OptionGrid multi options={complexityOptions} selected={responses.complexityFeatures ?? []} onSelect={(value) => toggleMulti("complexityFeatures", value, ["none_or_unsure"])} /> : null}
              {step === 6 ? <OptionGrid options={priorityOptions} selected={responses.priority ? [responses.priority] : []} onSelect={(value) => selectSingle("priority", value as RoofAssessmentResponses["priority"])} /> : null}
              {step === 7 ? <OptionGrid options={timelineOptions} selected={responses.timeline ? [responses.timeline] : []} onSelect={(value) => selectSingle("timeline", value as RoofAssessmentResponses["timeline"])} /> : null}
              {step === 8 ? <OptionGrid options={ownershipOptions} selected={responses.ownership ? [responses.ownership] : []} onSelect={(value) => selectSingle("ownership", value as RoofAssessmentResponses["ownership"])} /> : null}
              {message ? <p className="mt-6 border-l-2 border-cyan-700 pl-4 text-sm leading-6 text-slate-600">{message}</p> : null}
              {error ? <p role="alert" className="mt-5 text-sm font-semibold text-red-700">{error}</p> : null}
            </div>

            <nav aria-label="Assessment controls" className="assessment-question-actions mt-9 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
              <button type="button" disabled={step === 0 || saving} onClick={() => {
                setStep((current) => Math.max(0, current - 1));
                window.scrollTo({top: 0, behavior: "smooth"});
              }} className="assessment-back-action rounded-lg px-3 py-3 text-sm font-bold text-slate-500 disabled:opacity-30">Back</button>
              <button type="button" disabled={!answered() || saving} onClick={continueAssessment} className="assessment-primary-action min-h-14 rounded-xl bg-slate-950 px-7 py-3.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-35">
                {saving ? "Saving…" : step === 8 ? "See my roof assessment" : error ? "Try again" : "Continue"}
              </button>
            </nav>
          </div>
        </section>
      </div>
    </main>
  );
}
