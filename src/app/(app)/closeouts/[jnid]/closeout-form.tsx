"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { inputClasses, labelClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { CLOSEOUT_PACKAGE_PHOTO_LIMIT } from "@/domain/closeouts";
import { clearSignoff, saveCloseout, type CloseoutFormState } from "../actions";

export type CloseoutFormProps = {
  closeout: {
    id: string;
    version: number;
    jobJnid: string;
    installStartedOn: string | null;
    installCompletedOn: string | null;
    crew: string | null;
    squaresInstalled: number | null;
    layersRemoved: number | null;
    deckingSheetsReplaced: number | null;
    checklist: Record<string, string>;
    punchItems: string | null;
    productionNotes: string | null;
    featureNote: string | null;
    selectedPhotoJnids: string[];
    homeownerUnavailableReason: string | null;
    photosStatus: string;
  };
  signoff: {
    name: string;
    signedAt: string;
    photoRelease: string;
    reviewRequestOk: boolean;
    outcome: string;
  } | null;
  suggestions: {
    installDays: string | null;
    squares: string | null;
  };
  checklist: { key: string; label: string }[];
  photos: { fileJnid: string; thumbUrl: string | null; takenAt: string | null; outcome: string }[];
  initialGaps: string[];
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function takenLabel(iso: string | null) {
  if (!iso) return "Date not recorded";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function CloseoutForm(props: CloseoutFormProps) {
  const { closeout, signoff } = props;
  const [state, formAction, pending] = useActionState<CloseoutFormState, FormData>(saveCloseout, {
    error: null,
    gaps: props.initialGaps,
    savedAt: null,
    version: closeout.version,
  });
  const [selected, setSelected] = useState<string[]>(closeout.selectedPhotoJnids);
  const [answers, setAnswers] = useState<Record<string, string>>(closeout.checklist);
  const signed = signoff !== null;
  const preparing = closeout.photosStatus === "queued" || closeout.photosStatus === "preparing";
  const readyPhotos = props.photos.filter((photo) => photo.outcome === "ready" && photo.thumbUrl);
  const otherPhotos = props.photos.length - readyPhotos.length;
  const full = selected.length >= CLOSEOUT_PACKAGE_PHOTO_LIMIT;

  function togglePhoto(fileJnid: string) {
    setSelected((current) =>
      current.includes(fileJnid)
        ? current.filter((jnid) => jnid !== fileJnid)
        : current.length >= CLOSEOUT_PACKAGE_PHOTO_LIMIT
          ? current
          : [...current, fileJnid],
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="closeoutId" value={closeout.id} />
      <input type="hidden" name="version" value={state.version} />
      <input type="hidden" name="jobJnid" value={closeout.jobJnid} />

      <Section
        title="Installation"
        hint={props.suggestions.installDays ? `Suggested from the crew's photos: ${props.suggestions.installDays}.` : undefined}
      >
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClasses}>
            Started
            <input type="date" name="install_started_on" defaultValue={closeout.installStartedOn ?? ""} className={inputClasses} required />
          </label>
          <label className={labelClasses}>
            Finished
            <input
              type="date"
              name="install_completed_on"
              defaultValue={closeout.installCompletedOn ?? ""}
              className={inputClasses}
              required
              readOnly={signed}
              aria-describedby={signed ? "signed-lock" : undefined}
            />
          </label>
          <label className={`${labelClasses} col-span-2 sm:col-span-1`}>
            Crew
            <input name="crew" defaultValue={closeout.crew ?? ""} maxLength={120} className={inputClasses} placeholder="Who installed it" />
          </label>
          <label className={`${labelClasses} col-span-2 sm:col-span-1`}>
            Squares installed
            <input
              name="squares_installed"
              inputMode="decimal"
              defaultValue={closeout.squaresInstalled ?? ""}
              className={inputClasses}
              placeholder={props.suggestions.squares ?? "From the crew's count"}
            />
          </label>
          <label className={labelClasses}>
            Layers removed
            <input name="layers_removed" type="number" min={0} max={5} defaultValue={closeout.layersRemoved ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            Decking sheets replaced
            <input
              name="decking_sheets_replaced"
              type="number"
              min={0}
              max={500}
              defaultValue={closeout.deckingSheetsReplaced ?? ""}
              className={inputClasses}
            />
          </label>
        </div>
      </Section>

      <Section title="Quality checklist" hint="Mark each item done, or N/A when it doesn't apply to this roof.">
        <ul className="flex flex-col">
          {props.checklist.map((item) => (
            <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-2.5 last:border-b-0">
              <span className="min-w-0 text-[13px] text-ink">{item.label}</span>
              <span role="radiogroup" aria-label={item.label} className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border-strong">
                {(["done", "na"] as const).map((value) => (
                  <label
                    key={value}
                    className={`cursor-pointer px-3 py-1 text-xs font-medium transition ${
                      answers[item.key] === value ? "bg-fill-selected text-tint" : "bg-surface text-ink-muted hover:bg-fill-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`checklist.${item.key}`}
                      value={value}
                      checked={answers[item.key] === value}
                      onChange={() => setAnswers((current) => ({ ...current, [item.key]: value }))}
                      className="sr-only"
                    />
                    {value === "done" ? "Done" : "N/A"}
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Photos for the package"
        hint={`Pick up to ${CLOSEOUT_PACKAGE_PHOTO_LIMIT}. Before, tear-off, decking and finished slopes tell the story best.`}
      >
        {preparing ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-[13px] text-ink-muted">
            Copying the crew&apos;s photos from JobNimbus. This takes a minute or two; reload to see them.
          </p>
        ) : null}
        {closeout.photosStatus === "failed" ? (
          <p className="rounded-lg bg-warning-bg px-3 py-2 text-[13px] text-warning">
            Some photos couldn&apos;t be copied from JobNimbus. PIW will try again shortly.
          </p>
        ) : null}
        {readyPhotos.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-ink-subtle" aria-live="polite">
              {selected.length} of {CLOSEOUT_PACKAGE_PHOTO_LIMIT} picked
            </p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {readyPhotos.map((photo) => {
                const isSelected = selected.includes(photo.fileJnid);
                return (
                  <li key={photo.fileJnid}>
                    <label
                      className={`relative block cursor-pointer overflow-hidden rounded-lg border-2 transition ${
                        isSelected ? "border-tint" : "border-transparent"
                      } ${!isSelected && full ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        name="photo"
                        value={photo.fileJnid}
                        checked={isSelected}
                        disabled={!isSelected && full}
                        onChange={() => togglePhoto(photo.fileJnid)}
                        className="peer sr-only"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs, not optimizable */}
                      <img src={photo.thumbUrl ?? ""} alt={`Job photo, ${takenLabel(photo.takenAt)}`} loading="lazy" className="aspect-square w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{takenLabel(photo.takenAt)}</span>
                      {isSelected ? (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-tint text-[11px] font-semibold text-white">
                          {selected.indexOf(photo.fileJnid) + 1}
                        </span>
                      ) : null}
                      <span className="pointer-events-none absolute inset-0 rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-tint" />
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : !preparing ? (
          <p className="text-[13px] text-ink-subtle">No photos from the install window are on this job in JobNimbus yet.</p>
        ) : null}
        {otherPhotos > 0 ? (
          <p className="mt-3 text-xs text-ink-subtle">
            {otherPhotos} more {otherPhotos === 1 ? "photo is" : "photos are"} in JobNimbus but can&apos;t be previewed here (iPhone HEIC files or unreadable images).
          </p>
        ) : null}
      </Section>

      <Section title="Open items and notes">
        <div className="flex flex-col gap-4">
          <label className={labelClasses}>
            Open items the homeowner should know about
            <textarea
              name="punch_items"
              rows={3}
              maxLength={2000}
              defaultValue={closeout.punchItems ?? ""}
              readOnly={signed}
              className={inputClasses}
              placeholder="Leave empty if nothing is left to do"
            />
          </label>
          {signed ? (
            <p id="signed-lock" className="-mt-2 text-xs text-ink-subtle">
              The finish date and open items are what the homeowner signed. Clear the sign-off to change them.
            </p>
          ) : null}
          <label className={labelClasses}>
            Production notes (internal)
            <textarea name="production_notes" rows={3} maxLength={4000} defaultValue={closeout.productionNotes ?? ""} className={inputClasses} />
          </label>
          <label className={labelClasses}>
            One line about this job, for the project page if the homeowner allows photos
            <input
              name="feature_note"
              maxLength={280}
              defaultValue={closeout.featureNote ?? ""}
              className={inputClasses}
              placeholder="Two layers off, deck was solid except over the back porch"
            />
          </label>
        </div>
      </Section>

      <Section title="Homeowner sign-off">
        {signoff ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="text-[13px] text-ink">
              <p className="font-medium">
                Signed by {signoff.name},{" "}
                {new Date(signoff.signedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                })}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {signoff.outcome === "complete" ? "Confirmed complete" : "Confirmed complete except open items"} · Photos{" "}
                {signoff.photoRelease === "granted" ? "allowed" : "not allowed"} · Review link {signoff.reviewRequestOk ? "welcome" : "declined"}
              </p>
            </div>
            <button type="submit" formAction={clearSignoff} formNoValidate className={secondaryButtonClasses}>
              Clear sign-off
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-ink-muted">
              At the walkthrough, save and hand your phone to the homeowner. They confirm the work, answer two questions and sign.
              Nothing internal is shown to them.
            </p>
            <div>
              <button type="submit" name="intent" value="signoff" disabled={pending} className={primaryButtonClasses}>
                Save and hand to homeowner
              </button>
            </div>
            <label className={labelClasses}>
              Or, if the homeowner can&apos;t sign, say why
              <input
                name="homeowner_unavailable_reason"
                maxLength={500}
                defaultValue={closeout.homeownerUnavailableReason ?? ""}
                className={inputClasses}
                placeholder="Out of state; walked the job by video call"
              />
            </label>
          </div>
        )}
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border md:shadow-card">
        {state.error ? (
          <div role="alert" className="text-[13px]">
            <p className="font-medium text-danger">{state.error}</p>
            {state.gaps.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-ink-muted">
                {state.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : !state.savedAt && state.gaps.length > 0 ? (
          <p className="text-xs text-ink-subtle">Before submitting: {state.gaps.join(" · ")}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.savedAt && !state.error ? (
            <span className="mr-auto" aria-live="polite">
              <Badge tone="success">
                Saved{" "}
                {new Date(state.savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}
              </Badge>
            </span>
          ) : null}
          <button type="submit" name="intent" value="save" disabled={pending} className={secondaryButtonClasses}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="submit" name="intent" value="submit" disabled={pending} className={primaryButtonClasses}>
            Submit closeout
          </button>
        </div>
      </div>
    </form>
  );
}
