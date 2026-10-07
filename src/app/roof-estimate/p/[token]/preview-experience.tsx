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
import "../../quiet/quiet.css";
import { QuietHeader } from "../../quiet/quiet-header";

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
      <dl className="quiet-facts">
        <div className="quiet-fact">
          <dt>Measured from above</dt>
          <dd>About {roof.squares} roofing squares</dd>
        </div>
        <div className="quiet-fact">
          <dt>Complexity</dt>
          <dd>{COMPLEXITY_LABEL[roof.complexity]}</dd>
        </div>
      </dl>
    );
  }
  if (roof.state === "pending") {
    return (
      <p role="status" aria-live="polite" className="quiet-facts quiet-fact-note">
        Measuring your roof…
      </p>
    );
  }
  if (roof.state === "review_required") {
    return (
      <p className="quiet-facts quiet-fact-note">
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
    return <p role="status" className="quiet-email-status">Sent. Check your inbox for your roof report.</p>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="quiet-back">
        Email me this roof report
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="quiet-form quiet-email-form" noValidate>
      <label className="quiet-field">
        Email for your report
        <input name="email" type="email" inputMode="email" autoComplete="email" required className="quiet-input" />
      </label>
      <p data-testid="preview-email-notice" className="quiet-notice">{reportEmailNotice(brandName)}</p>
      {state === "limited" || state === "error" ? (
        <p role="alert" className="quiet-alert">
          {state === "limited" ? "We’ve already sent this report today. Check your inbox." : "We could not send your report. Please try again."}
        </p>
      ) : null}
      <button type="submit" disabled={state === "sending"} className="quiet-secondary">
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
  logoUrl,
  privacyUrl,
  initialStage = "loading",
  aerialLoader = loadAssessmentAerial,
}: {
  token: string;
  initialView: PreviewView;
  context: RoofAssessmentContext;
  brandName: string;
  logoUrl?: string;
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
        quiet={{brandName, logoUrl}}
      />
    );
  }

  const quietHeader = <QuietHeader brandName={brandName} logoUrl={logoUrl} />;

  if (stage === "question") {
    const question = QUESTIONS.find((item) => item.key === flow[questionIndex])!;
    return (
      <main className="quiet-flow">
        <div className="quiet-frame">
          {quietHeader}
          <section className="quiet-body">
            <p className="quiet-step">
              Question {questionIndex + 1} of {flow.length}
            </p>
            <h1 className="quiet-question">{question.title}</h1>
            <div className="quiet-options">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => answer(question.key, option.value)}
                  className="quiet-option"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={back} className="quiet-back">
              Back
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (stage === "contact") {
    return (
      <main className="quiet-flow">
        <div className="quiet-frame">
          {quietHeader}
          <section className="quiet-body">
            <h1 className="quiet-question">Where should we send your price?</h1>
            <p className="quiet-lede">
              Your Good, Better and Best options for {view.address.display} are one step away.
            </p>
            <form onSubmit={submitContact} className="quiet-form" noValidate>
              <label className="quiet-field">
                Full name
                <input name="name" autoComplete="name" required minLength={2} className="quiet-input" />
              </label>
              <label className="quiet-field">
                Email
                <input name="email" type="email" inputMode="email" autoComplete="email" required className="quiet-input" />
              </label>
              <label className="quiet-field">
                Mobile phone
                <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={7} className="quiet-input" />
              </label>
              <p data-testid="preview-contact-notice" className="quiet-notice">
                {contactOnlyNotice(brandName)}{" "}
                <a href={privacyUrl}>Privacy Policy</a>
              </p>
              {contactError ? <p role="alert" className="quiet-alert">{contactError}</p> : null}
              <button type="submit" disabled={submitting} className="quiet-submit">
                {submitting ? "Unlocking your price…" : PREVIEW_CONTACT_SUBMIT_LABEL}
              </button>
            </form>
            <button type="button" onClick={back} className="quiet-back">
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
    <main className="quiet-flow">
      <div className="quiet-frame quiet-frame-wide">
        {quietHeader}
        <section aria-label="Your roof preview" className="quiet-body quiet-reveal">
          <figure className="quiet-aerial">
            {aerial.kind === "ready" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={aerial.objectUrl} alt={`Aerial view of ${view.address.display}`} />
            ) : (
              <figcaption className="quiet-aerial-pending">
                {view.image.state === "ready" ? "Finalizing your property imagery" : "We’ll review this address with you."}
              </figcaption>
            )}
          </figure>

          <div className="quiet-reveal-copy">
            <p className="quiet-step">
              {view.address.googleConfirmed ? "Confirmed property" : context.kicker}
            </p>
            <p className="quiet-address">{view.address.display}</p>
            <Link href="/roof-estimate" className="quiet-back">
              Not your property? Update the address
            </Link>

            <h1 className="quiet-question quiet-reveal-title">Here’s your roof.</h1>
            <RoofSummary roof={view.roof} />
            <p className="quiet-lede">
              {remaining.length === 0
                ? "Your price is ready to unlock."
                : "A few quick taps tailor your estimate. No measurements or roofing knowledge needed."}
            </p>
            <button type="button" onClick={startQuestions} className="quiet-submit quiet-cta">
              {ctaLabel}
            </button>
            <EmailReport token={token} brandName={brandName} initiallySaved={view.savedEmail} />
          </div>
        </section>
      </div>
    </main>
  );
}
