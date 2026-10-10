import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import type { LeadStage } from "@/modules/leads/change-lead-stage";
import { CLOSED_STAGES, OPEN_STAGES, type PipelineCard } from "@/modules/leads/pipeline-view";
import { EstimateText, NextStepText, StageMenu } from "./pipeline-parts";

export type ListFilter = "open" | LeadStage;

function stageTone(stage: LeadStage) {
  if (stage === "won") return "success" as const;
  if (stage === "lost") return "danger" as const;
  if (stage === "new") return "info" as const;
  return "neutral" as const;
}

export function PipelineList({ cards, filter }: { cards: PipelineCard[]; filter: ListFilter }) {
  const filters: ListFilter[] = ["open", ...OPEN_STAGES, ...CLOSED_STAGES];
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Stage filter" className="flex flex-wrap gap-1.5">
        {filters.map((option) => (
          <Link
            key={option}
            href={option === "open" ? "/pipeline?view=list" : `/pipeline?view=list&stage=${option}`}
            aria-current={filter === option ? "page" : undefined}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              filter === option
                ? "bg-fill-selected text-tint"
                : "border border-border-strong bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {option === "open" ? "All open" : humanize(option)}
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[820px] text-left">
          <thead>
            <tr className="border-b border-border text-xs text-ink-subtle">
              <th scope="col" className="px-4 py-2.5 font-medium">Lead</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Estimate</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Next step</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Age</th>
              <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className="border-b border-border last:border-b-0 hover:bg-fill-hover/60">
                <td className="px-4 py-2.5">
                  <Link href={`/leads/${card.id}`} className="text-[13px] font-medium text-ink hover:text-tint">
                    {card.name}
                  </Link>
                  <p className="max-w-72 truncate text-xs text-ink-subtle">{card.address}</p>
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={stageTone(card.stage)}>{humanize(card.stage)}</Badge>
                </td>
                <td className="px-3 py-2.5"><EstimateText estimate={card.estimate} /></td>
                <td className="max-w-64 px-3 py-2.5"><NextStepText nextStep={card.nextStep} /></td>
                <td className="px-3 py-2.5 text-[13px] text-ink-subtle">{card.ageLabel}</td>
                <td className="px-3 py-2.5"><StageMenu leadId={card.id} stage={card.stage} /></td>
              </tr>
            ))}
            {cards.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-ink-subtle">
                  No leads match this filter
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
