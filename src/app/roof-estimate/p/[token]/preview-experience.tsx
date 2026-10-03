"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { RoofAssessmentContext } from "@/config/roof-assessment";
import type { PreviewView } from "@/modules/property-preview/preview-read-model";
import {
  contactOnlyNotice,
  PREVIEW_CONTACT_SUBMIT_LABEL,
  PREVIEW_EMAIL_SUBMIT_LABEL,
  reportEmailNotice,
} from "@/modules/property-preview/notices";
import { loadAssessmentAerial } from "../../[token]/assessment-aerial-loader";
import { useAssessmentAerial } from "../../[token]/assessment-experience";
import { AssessmentLoading } from "../../[token]/assessment-loading";
import {
  assessmentQuestionTitles,
  reasonOptions,
  roofAgeOptions,
  timelineOptions,
  type AssessmentOption,
} from "../../[token]/assessment-questions";
import "../../[token]/assessment.css";

type Stage = "loading" | "reveal" | "question" | "contact";
type QuestionKey = "reason" | "roofAge" | "timeline";

const QUESTIONS: Array<{key: QuestionKey; title: string; options: AssessmentOption[]}> = [
  {key: "reason", title: assessmentQuestionTitles.reason, options: reasonOptions},
  {key: "roofAge", title: assessmentQuestionTitles.roofAge, options: roofAgeOptions},
  {key: "timeline", title: assessmentQuestionTitles.timeline, options: timelineOptions},
];

const COMPLEXITY_LABEL = {
  simple: "Simple roof",
  moderate: "Moderately complex roof",
  complex: "Complex roof",
} as const;

const VIEW_POLL_MS = 2_500;
const MAX_VIEW_POLLS = 30;

function beacon(token: string, step: "revealed" | "contact_viewed") {
  void fetch(`/api/property-preview/${token}/progress`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({step}),
    keepalive: true,
  }).catch(() => undefined);
}

function RoofSummary({roof}: {roof: PreviewView["roof"]}) {
  if (roof.state === "ready") {
    return (
      <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Measured from above</p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">About {roof.squares} roofing squares</p>
        <p className="mt-1 text-sm font-semibold text-slate-600">{COMPLEXITY_LABEL[roof.complexity]}</p>
      </div>
    );
  }
  if (roof.state === "pending") {
    return (
      <p role="status" aria-live="polite" className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-700">
        Measuring your roof…
      </p>
    );
  }
  if (roof.state === "review_required") {
    return (
      <p className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
        A roofing specialist will confirm your roof’s measurements.
      </p>
    );
  }
  return null;
}

function EmailReport({token, brandName, initiallySaved}: {token: string; brandName: string; initiallySaved: boolean}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "limited" | "error">(initiallySaved ? "sent" : "idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || !event.currentTarget.reportValidity()) return;
    setState("sending");
    const response = await fetch(`/api/property-preview/${token}/save-report`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({email: String(new FormData(event.currentTarget).get("email") ?? "").trim()}),
    }).catch(() => null);
    setState(response?.status === 204 ? "sent" : response?.status === 429 ? "limited" : "error");
  }

  if (state === "sent") {
    return <p role="status" className="mt-5 text-sm font-semibold text-slate-700">Sent. Check your inbox for your roof report.</p>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-5 text-sm font-semibold text-slate-700 underline underline-offset-4">
        Email me this roof report
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="mt-5 grid gap-3 rounded-2xl border border-slate-200 p-4" noValidate>
      <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
        Email for your report
        <input name="email" type="email" inputMode="email" autoComplete="email" required className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base" />
      </label>
      <p data-testid="preview-email-notice" className="text-xs leading-5 text-slate-500">{reportEmailNotice(brandName)}</p>
      {state === "limited" || state === "error" ? (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {state === "limited" ? "We’ve already sent this report today. Check your inbox." : "We could not send your report. Please try again."}
        </p>
      ) : null}
      <button type="submit" disabled={state === "sending"} className="min-h-12 rounded-xl border border-slate-900 px-5 text-sm font-bold text-slate-900 disabled:opacity-65">
        {state === "sending" ? "Sending…" : PREVIEW_EMAIL_SUBMIT_LABEL}
      </button>
    </form>
  );
}

export function PreviewExperience({
  token,
  initialView,
  context,
  brandName,
  privacyUrl,
  initialStage = "loading",
  aerialLoader = loadAssessmentAerial,
}: {
  token: string;
  initialView: PreviewView;
  context: RoofAssessmentContext;
  brandName: string;
  privacyUrl: string;
  initialStage?: Stage;
  aerialLoader?: typeof loadAssessmentAerial;
}) {
  const imageUrl = `/api/property-preview/${token}/house-image`;
  const [stage, setStage] = useState<Stage>(initialStage);
  const [view, setView] = useState(initialView);
  const [answered, setAnswered] = useState<Set<QuestionKey>>(() => new Set(initialView.answered));
  const remaining = QUESTIONS.filter((question) => !answered.has(question.key));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [submissionId] = useState(() => globalThis.crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const revealSent = useRef(false);
  const contactSent = useRef(false);
  const [flow, setFlow] = useState<QuestionKey[]>([]);

  const aerial = useAssessmentAerial({
    aerialLoader,
    enabled: view.image.state === "ready" && (stage === "loading" || stage === "reveal"),
    imageUrl,
    stage: stage === "loading" ? "loading" : stage === "reveal" ? "reveal" : "questions",
  });

  useEffect(() => {
    if (stage === "reveal" && !revealSent.current) {
      revealSent.current = true;
      beacon(token, "revealed");
    }
    if (stage === "contact" && !contactSent.current) {
      contactSent.current = true;
      beacon(token, "contact_viewed");
    }
  }, [stage, token]);

  // The Solar measurement usually lands within seconds of the preview being
  // created; keep the reveal current without making the homeowner wait.
  useEffect(() => {
    if (view.roof.state !== "pending") return;
    let polls = 0;
    let active = true;
    const timer = window.setInterval(async () => {
      polls += 1;
      if (polls > MAX_VIEW_POLLS) {
        window.clearInterval(timer);
        return;
      }
      const response = await fetch(`/api/property-preview/${token}`, {cache: "no-store"}).catch(() => null);
      if (!active || !response?.ok) return;
      const next = await response.json().catch(() => null) as PreviewView | null;
      if (next) setView(next);
    }, VIEW_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token, view.roof.state]);

  function startQuestions() {
    const keys = remaining.map((question) => question.key);
    setFlow(keys);
    setQuestionIndex(0);
    setStage(keys.length ? "question" : "contact");
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  function answer(key: QuestionKey, value: string) {
    void fetch(`/api/property-preview/${token}/answers`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({[key]: value}),
      keepalive: true,
    }).catch(() => undefined);
    setAnswered((current) => new Set(current).add(key));
    if (questionIndex + 1 < flow.length) setQuestionIndex(questionIndex + 1);
    else setStage("contact");
  }

  function back() {
    if (stage === "contact") {
      if (flow.length) {
        setQuestionIndex(flow.length - 1);
        setStage("question");
      } else {
        setStage("reveal");
      }
      return;
    }
    if (questionIndex > 0) setQuestionIndex(questionIndex - 1);
    else setStage("reveal");
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !event.currentTarget.reportValidity()) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setContactError(null);
    const response = await fetch(`/api/property-preview/${token}/convert`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        submission_id: submissionId,
        name: String(form.get("name") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(),
      }),
    }).catch(() => null);
    const payload = response?.status === 202
      ? await response.json().catch(() => null) as {continuationPath?: string} | null
      : null;
    if (payload?.continuationPath?.startsWith("/roof-estimate/continue/")) {
      window.location.assign(payload.continuationPath);
      return;
    }
    setSubmitting(false);
    setContactError(response?.status === 404
      ? "This preview has expired. Start again with your address to see your price."
      : "We could not unlock your price. Please try again, or call us.");
  }

  if (stage === "loading") {
    return (
      <AssessmentLoading
        address={view.address.display}
        imageSrc={imageUrl}
        imageObjectUrl={aerial.objectUrl}
        stages={context.loadingStages}
        onReady={() => setStage("reveal")}
      />
    );
  }

  const shell = `assessment-flow ${context.accentClass} min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#edf2f3] px-4 py-5 text-slate-950 sm:px-7 sm:py-8`;
  const header = (
    <header className="assessment-nav flex items-center justify-between border-b border-slate-300/80 pb-5">
      <div>
        <p className="text-xs font-black tracking-[0.2em] text-slate-900">{brandName.toUpperCase()}</p>
        <p className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">Personalized RoofCheck</p>
      </div>
    </header>
  );

  if (stage === "question") {
    const question = QUESTIONS.find((item) => item.key === flow[questionIndex])!;
    return (
      <main className={shell}>
        <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-3xl flex-col">
          {header}
          <section className="my-auto py-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Question {questionIndex + 1} of {flow.length}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{question.title}</h1>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => answer(question.key, option.value)}
                  className="min-h-14 rounded-xl border border-slate-300 bg-white px-5 py-4 text-left text-base font-semibold text-slate-900 transition hover:border-slate-900 active:translate-y-px"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={back} className="mt-6 text-sm font-semibold text-slate-600 underline underline-offset-4">
              Back
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (stage === "contact") {
    return (
      <main className={shell}>
        <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-xl flex-col">
          {header}
          <section className="my-auto py-8">
            <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Where should we send your price?</h1>
            <p className="mt-3 text-base leading-7 text-slate-600">
              Your Good, Better and Best options for {view.address.display} are one step away.
            </p>
            <form onSubmit={submitContact} className="mt-7 grid gap-4" noValidate>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Full name
                <input name="name" autoComplete="name" required minLength={2} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Email
                <input name="email" type="email" inputMode="email" autoComplete="email" required className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base" />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Mobile phone
                <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={7} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base" />
              </label>
              <p data-testid="preview-contact-notice" className="text-xs leading-5 text-slate-500">
                {contactOnlyNotice(brandName)}{" "}
                <a href={privacyUrl} className="underline underline-offset-2">Privacy Policy</a>
              </p>
              {contactError ? <p role="alert" className="text-sm font-semibold text-red-700">{contactError}</p> : null}
              <button
                type="submit"
                disabled={submitting}
                className="assessment-primary-action min-h-14 rounded-xl bg-slate-950 px-5 py-4 text-base font-black text-white transition hover:bg-slate-800 active:translate-y-px disabled:cursor-wait disabled:opacity-65"
              >
                {submitting ? "Unlocking your price…" : PREVIEW_CONTACT_SUBMIT_LABEL}
              </button>
            </form>
            <button type="button" onClick={back} className="mt-6 text-sm font-semibold text-slate-600 underline underline-offset-4">
              Back
            </button>
          </section>
        </div>
      </main>
    );
  }

  const ctaLabel = remaining.length === 0
    ? "See my price"
    : `Answer ${remaining.length} quick question${remaining.length === 1 ? "" : "s"}`;

  return (
    <main className={`${shell} assessment-reveal-shell`}>
      <div className="assessment-reveal-frame mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-7xl flex-col">
        {header}
        <div className="assessment-reveal-stage my-auto py-6 lg:py-10">
          <section
            aria-label="Your roof preview"
            className="assessment-reveal-card grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,42,55,0.16)] lg:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]"
          >
            <div className="assessment-reveal-visual relative min-h-[23rem] overflow-hidden bg-[#102f3d] sm:min-h-[32rem] lg:min-h-[39rem]">
              {aerial.kind === "ready" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={aerial.objectUrl} alt={`Aerial view of ${view.address.display}`} className="assessment-reveal-aerial absolute inset-0 size-full object-cover" />
              ) : (
                <div className="assessment-imagery-pending absolute inset-0 grid place-items-center px-6">
                  <p className="max-w-xs text-center text-sm font-bold text-white">
                    {view.image.state === "ready" ? "Finalizing your property imagery" : "We’ll review this address with you."}
                  </p>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/15" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
                {view.address.googleConfirmed ? (
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-white/60">Confirmed property</p>
                ) : null}
                <p className="mt-2 max-w-2xl text-lg font-semibold tracking-[-0.02em] sm:text-xl">{view.address.display}</p>
                <Link href="/roof-estimate" className="mt-3 inline-flex text-xs font-semibold text-white/70 underline underline-offset-4 hover:text-white">
                  Not your property? Update the address
                </Link>
              </div>
            </div>

            <div className="assessment-reveal-copy flex flex-col justify-center border-t border-slate-200 bg-white p-7 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
              <p className="assessment-context-kicker text-xs font-black uppercase tracking-[0.19em]">{context.kicker}</p>
              <h1 className="assessment-display mt-3 text-[clamp(2.6rem,5vw,4.6rem)] leading-[0.92] tracking-[0.01em]">
                Here’s your roof.
              </h1>
              <RoofSummary roof={view.roof} />
              <p className="mt-6 max-w-lg text-base leading-7 text-slate-600">
                {remaining.length === 0
                  ? "Your price is ready to unlock."
                  : "A few quick taps tailor your estimate. No measurements or roofing knowledge needed."}
              </p>
              <button
                type="button"
                onClick={startQuestions}
                className="assessment-primary-action mt-7 w-full rounded-xl bg-slate-950 px-5 py-4 text-sm font-black text-white transition hover:bg-slate-800 active:translate-y-px"
              >
                {ctaLabel}
              </button>
              <EmailReport token={token} brandName={brandName} initiallySaved={view.savedEmail} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
