import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { humanize } from "@/lib/format";
import { leadStages, type LeadStage } from "@/modules/leads/change-lead-stage";
import {
  formatCompactCurrency,
  type CardEstimate,
  type NextStepDue,
  type PipelineCard,
} from "@/modules/leads/pipeline-view";
import { moveLeadStage } from "./actions";

export const DUE_TEXT: Record<NextStepDue, string> = {
  overdue: "text-danger",
  today: "text-warning",
  upcoming: "text-ink-muted",
  unscheduled: "text-ink-subtle",
};

const DUE_SUFFIX: Record<NextStepDue, string> = {
  overdue: "overdue",
  today: "today",
  upcoming: "upcoming",
  unscheduled: "no date",
};

export function EstimateText({ estimate }: { estimate: CardEstimate }) {
  if (estimate.kind === "ready") {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {formatCompactCurrency(estimate.lowCents)}–{formatCompactCurrency(estimate.highCents)}
        </span>
        {estimate.squares !== null ? (
          <span className="text-xs text-ink-subtle">{estimate.squares.toFixed(1)} sq</span>
        ) : null}
      </span>
    );
  }
  const label =
    estimate.kind === "pending"
      ? "Measuring roof…"
      : estimate.kind === "unavailable"
        ? "Needs manual estimate"
        : "No estimate";
  return <span className="text-[13px] text-ink-subtle">{label}</span>;
}

export function NextStepText({ nextStep }: { nextStep: PipelineCard["nextStep"] }) {
  if (!nextStep) return <span className="text-xs text-ink-subtle">No open tasks</span>;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 text-xs font-medium ${DUE_TEXT[nextStep.due]}`}>
      <Icon name="clock" size={13} className="shrink-0" />
      <span className="truncate">
        {nextStep.title} · {DUE_SUFFIX[nextStep.due]}
      </span>
    </span>
  );
}

// A no-JS stage menu: each stage is a submit button in one server-action form.
export function StageMenu({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  return (
    <details className="group relative z-10">
      <summary
        aria-label="Move to stage"
        className="flex cursor-pointer list-none items-center rounded-md p-1 text-ink-subtle transition hover:bg-fill-hover hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <Icon name="more" />
      </summary>
      <form
        action={async (formData) => {
          "use server";
          await moveLeadStage(leadId, formData.get("toStage") as LeadStage);
        }}
        className="absolute right-0 mt-1 w-48 rounded-xl bg-surface p-1 shadow-raised"
      >
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-ink-subtle">Move to</p>
        {leadStages.map((option) => (
          <button
            key={option}
            type="submit"
            name="toStage"
            value={option}
            disabled={option === stage}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-tint hover:text-white disabled:cursor-default disabled:bg-transparent disabled:text-ink-subtle"
          >
            <span className="w-3.5">{option === stage ? <Icon name="check" size={14} /> : null}</span>
            {humanize(option)}
          </button>
        ))}
      </form>
    </details>
  );
}

export function ViewSwitcher({ view }: { view: "board" | "list" }) {
  const options = [
    { value: "board", label: "Board", href: "/pipeline" },
    { value: "list", label: "List", href: "/pipeline?view=list" },
  ] as const;
  return (
    <nav aria-label="Pipeline view" className="flex rounded-lg bg-fill-hover p-0.5">
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          aria-current={view === option.value ? "page" : undefined}
          className={`rounded-md px-3 py-0.5 text-xs transition ${
            view === option.value ? "bg-surface font-medium text-ink shadow-card" : "text-ink-muted hover:text-ink"
          }`}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}
