"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  addOnAmountCents,
  optionTotalCents,
  type AddOnKind,
  type MeasurementSource,
  type ProposalStatus,
} from "@/domain/proposals";
import type { RoofPricingTierKey } from "@/domain/roof-pricing";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClasses, plainButtonClasses, primaryButtonClasses, secondaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { reviseProposal, saveProposalDraft, sendProposal, setProposalOutcome } from "../actions";

export type BuilderOption = {
  tierKey: RoofPricingTierKey;
  manufacturerName: string | null;
  productLineName: string | null;
  customerName: string;
  customerDescription: string;
  warrantySummary: string;
  pricePerSquareCents: number;
};

export type BuilderAddOn = {
  id: string;
  label: string;
  explanation: string | null;
  calculationKind: AddOnKind;
  unitValue: number;
  quantity: number;
  included: boolean;
};

export type BuilderProposal = {
  id: string;
  version: number;
  status: ProposalStatus;
  roofSquares: number;
  measurementSource: MeasurementSource;
  pitch12: number | null;
  stories: number | null;
  layersToRemove: number | null;
  recommendedTier: RoofPricingTierKey;
  validUntil: string;
  notes: string | null;
  sentAt: string | null;
  options: BuilderOption[];
  addOns: BuilderAddOn[];
};

const TIER_LABEL: Record<RoofPricingTierKey, string> = { good: "Good", better: "Better", best: "Best" };

const SOURCE_BADGE: Record<MeasurementSource, { tone: BadgeTone; label: string }> = {
  roofr: { tone: "success", label: "Roofr report" },
  google_solar: { tone: "info", label: "Google Solar estimate" },
  manual: { tone: "neutral", label: "Entered by hand" },
};

const STATUS_TONE: Record<ProposalStatus, BadgeTone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  declined: "danger",
  void: "neutral",
};

function dollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-ink">{children}</dd>
    </div>
  );
}

const smallInput = `${inputClasses} mt-0 w-24 px-2 py-1 text-right text-[13px]`;

export function ProposalBuilder({
  leadId,
  customerName,
  proposal,
  preliminary,
}: {
  leadId: string;
  customerName: string;
  proposal: BuilderProposal;
  preliminary: { lowCents: number; highCents: number; roofSquares: number | null } | null;
}) {
  const [draft, setDraft] = useState(proposal);
  const editable = draft.status === "draft";
  const [editingMeasurements, setEditingMeasurements] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Counts edits so a save that finishes after a newer edit doesn't report
  // the draft as saved.
  const edits = useRef(0);

  // Autosave: write the whole draft shortly after the last edit.
  useEffect(() => {
    if (edits.current === 0 || !editable) return;
    const edit = edits.current;
    const timer = setTimeout(async () => {
      const result = await saveProposalDraft(leadId, draft.id, {
        roofSquares: draft.roofSquares,
        measurementSource: draft.measurementSource,
        pitch12: draft.pitch12,
        stories: draft.stories,
        layersToRemove: draft.layersToRemove,
        recommendedTier: draft.recommendedTier,
        validUntil: draft.validUntil,
        notes: draft.notes,
        options: draft.options.map((option) => ({
          tierKey: option.tierKey,
          pricePerSquareCents: option.pricePerSquareCents,
        })),
        addOns: draft.addOns.map((addOn) => ({
          id: addOn.id,
          included: addOn.included,
          quantity: addOn.quantity,
          unitValue: addOn.unitValue,
        })),
      });
      if (edit !== edits.current) return;
      setSaveState("error" in result ? "error" : "saved");
      setMessage("error" in result ? result.error : null);
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, editable, leadId]);

  const squaresValid = Number.isFinite(draft.roofSquares) && draft.roofSquares > 0;
  const priced = useMemo(() => {
    if (!squaresValid) return null;
    const optionTotals = new Map(
      draft.options.map((option) => [option.tierKey, optionTotalCents(draft.roofSquares, option.pricePerSquareCents)]),
    );
    const recommendedTotal = optionTotals.get(draft.recommendedTier) ?? 0;
    const addOnAmounts = new Map(
      draft.addOns.map((addOn) => [addOn.id, addOnAmountCents(addOn, draft.roofSquares, recommendedTotal)]),
    );
    const included = draft.addOns.filter((addOn) => addOn.included);
    const addOnsTotal = included.reduce((sum, addOn) => sum + (addOnAmounts.get(addOn.id) ?? 0), 0);
    return {
      optionTotals,
      addOnAmounts,
      includedCount: included.length,
      recommendedTotal,
      addOnsTotal,
      total: recommendedTotal + addOnsTotal,
    };
  }, [draft, squaresValid]);

  const update = (patch: Partial<BuilderProposal>) => {
    edits.current += 1;
    setSaveState("saving");
    setDraft((current) => ({ ...current, ...patch }));
  };
  // Status changes come from the server actions, not edits, so they don't save.
  const setStatus = (status: ProposalStatus) => setDraft((current) => ({ ...current, status }));
  const updateOption = (tierKey: RoofPricingTierKey, pricePerSquareCents: number) =>
    update({
      options: draft.options.map((option) => (option.tierKey === tierKey ? { ...option, pricePerSquareCents } : option)),
    });
  const updateAddOn = (id: string, patch: Partial<BuilderAddOn>) =>
    update({ addOns: draft.addOns.map((addOn) => (addOn.id === id ? { ...addOn, ...patch } : addOn)) });

  const recommended = draft.options.find((option) => option.tierKey === draft.recommendedTier);
  const firstName = customerName.split(/\s+/)[0] || customerName;
  const source = SOURCE_BADGE[draft.measurementSource];
  const withinRange =
    preliminary && priced ? priced.total >= preliminary.lowCents && priced.total <= preliminary.highCents : null;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-bold tracking-tight text-ink">Proposal</h1>
            <Badge tone={STATUS_TONE[draft.status]}>
              {draft.status === "draft" ? "Draft" : draft.status[0].toUpperCase() + draft.status.slice(1)}
            </Badge>
            <span className="text-[13px] text-ink-subtle">v{draft.version}</span>
          </div>
          {editable ? (
            <span role="status" className={`text-[13px] ${saveState === "error" ? "text-danger" : "text-ink-subtle"}`}>
              {saveState === "saving" ? "Saving…" : saveState === "error" ? message ?? "Not saved" : "Autosaved"}
            </span>
          ) : null}
        </div>

        <Card
          title="Measurements"
          ariaLabel="Measurements"
          right={
            <div className="flex items-center gap-3">
              <Badge tone={source.tone}>{source.label}</Badge>
              {editable ? (
                <button type="button" className={plainButtonClasses} onClick={() => setEditingMeasurements((open) => !open)}>
                  {editingMeasurements ? "Done" : "Edit"}
                </button>
              ) : null}
            </div>
          }
        >
          {editingMeasurements ? (
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="text-[13px] text-ink-muted">
                Roof area (sq)
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className={inputClasses}
                  defaultValue={draft.roofSquares}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (value > 0) update({ roofSquares: value, measurementSource: "manual" });
                  }}
                />
              </label>
              <label className="text-[13px] text-ink-muted">
                Pitch (/12)
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="30"
                  className={inputClasses}
                  defaultValue={draft.pitch12 ?? ""}
                  onChange={(event) => update({ pitch12: numberOrNull(event.target.value) })}
                />
              </label>
              <label className="text-[13px] text-ink-muted">
                Layers to remove
                <input
                  type="number"
                  min="0"
                  max="4"
                  className={inputClasses}
                  defaultValue={draft.layersToRemove ?? ""}
                  onChange={(event) => update({ layersToRemove: numberOrNull(event.target.value) })}
                />
              </label>
              <label className="text-[13px] text-ink-muted">
                Stories
                <input
                  type="number"
                  min="1"
                  max="6"
                  className={inputClasses}
                  defaultValue={draft.stories ?? ""}
                  onChange={(event) => update({ stories: numberOrNull(event.target.value) })}
                />
              </label>
            </div>
          ) : (
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Row label="Roof area">
                {draft.roofSquares.toFixed(1)} sq
                {preliminary?.roofSquares && draft.measurementSource !== "google_solar" ? (
                  <span className="font-normal text-ink-subtle"> (est. {preliminary.roofSquares.toFixed(1)})</span>
                ) : null}
              </Row>
              <Row label="Pitch">{draft.pitch12 === null ? "—" : `${draft.pitch12}/12`}</Row>
              <Row label="Layers to remove">{draft.layersToRemove ?? "—"}</Row>
              <Row label="Stories">{draft.stories ?? "—"}</Row>
            </dl>
          )}
        </Card>

        <section aria-labelledby="options-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="options-heading" className="text-xl font-semibold tracking-tight text-ink">Options</h2>
            <span className="text-[13px] text-ink-subtle">Customer picks one</span>
          </div>
          <div role="radiogroup" aria-label="Recommended option" className="grid gap-4 lg:grid-cols-3">
            {draft.options.map((option) => {
              const isRecommended = option.tierKey === draft.recommendedTier;
              return (
                <div
                  key={option.tierKey}
                  role="radio"
                  aria-checked={isRecommended}
                  tabIndex={editable ? 0 : -1}
                  onClick={() => editable && update({ recommendedTier: option.tierKey })}
                  onKeyDown={(event) => {
                    if (editable && (event.key === " " || event.key === "Enter")) {
                      event.preventDefault();
                      update({ recommendedTier: option.tierKey });
                    }
                  }}
                  className={`flex flex-col gap-2.5 rounded-2xl bg-surface px-[18px] py-4 shadow-card ${
                    isRecommended ? "border-2 border-tint" : "border-2 border-transparent"
                  } ${editable ? "cursor-pointer" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] text-ink-subtle">{TIER_LABEL[option.tierKey]}</span>
                    {isRecommended ? <Badge tone="info">Recommended</Badge> : null}
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{option.customerName}</p>
                    {option.manufacturerName &&
                    option.productLineName &&
                    `${option.manufacturerName} ${option.productLineName}` !== option.customerName ? (
                      <p className="text-xs text-ink-subtle">
                        {option.manufacturerName} {option.productLineName}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-xs text-ink-muted">{option.customerDescription}</p>
                  <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <Icon name="shield" size={14} className="text-success" />
                    {option.warrantySummary}
                  </p>
                  <p className="text-xl font-semibold tracking-tight text-ink">
                    {priced ? dollars(priced.optionTotals.get(option.tierKey) ?? 0) : "—"}
                  </p>
                  {editable ? (
                    <label
                      className="flex items-center justify-between gap-2 text-xs text-ink-muted"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Per square
                      <input
                        type="number"
                        min="1"
                        step="5"
                        aria-label={`${option.customerName} price per square`}
                        className={smallInput}
                        defaultValue={option.pricePerSquareCents / 100}
                        onChange={(event) => {
                          const value = Math.round(Number(event.target.value) * 100);
                          if (value > 0) updateOption(option.tierKey, value);
                        }}
                      />
                    </label>
                  ) : (
                    <p className="text-xs text-ink-subtle">{dollars(option.pricePerSquareCents)}/sq</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <Card title="Add-ons" ariaLabel="Add-ons">
          {draft.addOns.length === 0 ? (
            <p className="text-sm text-ink-subtle">The rate card has no add-ons.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {draft.addOns.map((addOn) => (
                <li key={addOn.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <label className="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-tint"
                      checked={addOn.included}
                      disabled={!editable}
                      onChange={(event) => updateAddOn(addOn.id, { included: event.target.checked })}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{addOn.label}</span>
                      {addOn.explanation ? (
                        <span className="mt-0.5 inline-flex items-start gap-1 text-xs text-info">
                          <Icon name="sparkle" size={12} className="mt-0.5 shrink-0" />
                          {addOn.explanation}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    {editable && addOn.included ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label={`${addOn.label} ${addOn.calculationKind === "percentage" ? "percent" : "amount"}`}
                          className={smallInput}
                          defaultValue={addOn.unitValue}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (value >= 0) updateAddOn(addOn.id, { unitValue: value });
                          }}
                        />
                        {addOn.calculationKind === "per_unit" ? (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            aria-label={`${addOn.label} quantity`}
                            className={`${smallInput} w-16`}
                            defaultValue={addOn.quantity}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (value >= 0) updateAddOn(addOn.id, { quantity: value });
                            }}
                          />
                        ) : null}
                      </>
                    ) : null}
                    <span className="w-20 text-right text-[13px] font-medium text-ink">
                      {priced ? dollars(priced.addOnAmounts.get(addOn.id) ?? 0) : "—"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <aside
        aria-label="Summary"
        className="flex min-w-0 flex-col gap-5 rounded-2xl bg-surface p-6 shadow-card xl:sticky xl:top-6"
      >
        <h2 className="text-xl font-semibold tracking-tight text-ink">Summary</h2>
        <dl className="flex flex-col">
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-ink-muted">Recommended option</dt>
            <dd className="text-right text-[13px] font-medium text-ink">
              {recommended?.customerName ?? "—"}
              <span className="block font-normal text-ink-subtle">{priced ? dollars(priced.recommendedTotal) : "—"}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-[13px] text-ink-muted">Add-ons ({priced?.includedCount ?? 0})</dt>
            <dd className="text-[13px] font-medium text-ink">{priced ? dollars(priced.addOnsTotal) : "—"}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <dt className="text-[15px] font-semibold text-ink">Total</dt>
            <dd className="text-[15px] font-semibold text-ink">{priced ? dollars(priced.total) : "—"}</dd>
          </div>
        </dl>

        {preliminary && withinRange !== null ? (
          <p
            className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] ${
              withinRange ? "bg-success-bg text-success" : "bg-warning-bg text-warning"
            }`}
          >
            <Icon name={withinRange ? "check" : "clock"} size={14} className="mt-0.5 shrink-0" />
            {withinRange ? "Within" : "Outside"} preliminary range ({dollars(preliminary.lowCents)}–
            {dollars(preliminary.highCents)})
          </p>
        ) : null}

        <label className="flex flex-col gap-1 text-[13px] text-ink">
          <span className="flex items-center justify-between gap-2">
            Valid until
            <span className="text-xs text-ink-subtle">Expires {formatDate(draft.validUntil)}</span>
          </span>
          {editable ? (
            <input
              type="date"
              className={inputClasses}
              defaultValue={draft.validUntil}
              onChange={(event) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) update({ validUntil: event.target.value });
              }}
            />
          ) : null}
        </label>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex gap-2">
            <a
              href={`/api/proposals/${draft.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className={`${secondaryButtonClasses} flex-1`}
            >
              Preview PDF
              <Icon name="chevronRight" size={14} />
            </a>
            {editable ? (
              <button
                type="button"
                className={`${primaryButtonClasses} flex-1`}
                disabled={pending || saveState !== "saved" || !priced}
                onClick={() =>
                  startTransition(async () => {
                    const result = await sendProposal(leadId, draft.id);
                    if ("error" in result) setMessage(result.error);
                    else setStatus("sent");
                  })
                }
              >
                <Icon name="send" size={14} />
                Send to {firstName}
              </button>
            ) : null}
          </div>
          {editable ? (
            <p className="text-xs text-ink-subtle">
              Marks it sent and moves {firstName} to Proposal sent. Share the PDF with the customer.
            </p>
          ) : null}
          {draft.status === "sent" ? (
            <div className="flex gap-2">
              <button
                type="button"
                className={`${primaryButtonClasses} flex-1`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setProposalOutcome(leadId, draft.id, "accepted");
                    if ("error" in result) setMessage(result.error);
                    else setStatus("accepted");
                  })
                }
              >
                <Icon name="check" size={14} />
                Mark accepted
              </button>
              <button
                type="button"
                className={`${secondaryButtonClasses} flex-1`}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await setProposalOutcome(leadId, draft.id, "declined");
                    if ("error" in result) setMessage(result.error);
                    else setStatus("declined");
                  })
                }
              >
                Mark declined
              </button>
            </div>
          ) : null}
          {!editable ? (
            <form action={reviseProposal.bind(null, leadId, draft.id)}>
              <button type="submit" className={`${secondaryButtonClasses} w-full`}>
                <Icon name="plus" size={14} />
                Revise as new version
              </button>
            </form>
          ) : null}
          {message && !editable ? <p role="alert" className="text-xs text-danger">{message}</p> : null}
        </div>
      </aside>
    </div>
  );
}
