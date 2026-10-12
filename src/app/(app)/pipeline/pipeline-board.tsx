import Link from "next/link";
import { humanize } from "@/lib/format";
import {
  CLOSED_STAGES,
  OPEN_STAGES,
  formatCompactCurrency,
  type PipelineCard,
} from "@/modules/leads/pipeline-view";
import { EstimateText, NextStepText, StageMenu } from "./pipeline-parts";

function stageValue(cards: PipelineCard[]): string | null {
  const high = cards.reduce(
    (sum, card) => sum + (card.estimate.kind === "ready" ? card.estimate.highCents : 0),
    0,
  );
  return high > 0 ? formatCompactCurrency(high) : null;
}

function LeadCard({ card }: { card: PipelineCard }) {
  return (
    <li className="relative flex flex-col gap-2 rounded-2xl bg-surface p-3 shadow-card transition hover:shadow-raised">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* The stretched link makes the whole card open the lead. */}
          <Link
            href={`/leads/${card.id}`}
            className="text-sm font-medium text-ink after:absolute after:inset-0 after:rounded-2xl"
          >
            {card.name}
          </Link>
          <p className="truncate text-xs text-ink-subtle">{card.address}</p>
        </div>
        <StageMenu leadId={card.id} stage={card.stage} />
      </div>
      <EstimateText estimate={card.estimate} />
      <div className="flex items-center justify-between gap-2">
        <NextStepText nextStep={card.nextStep} />
        <span className="shrink-0 text-xs text-ink-subtle">{card.ageLabel}</span>
      </div>
    </li>
  );
}

export function PipelineBoard({ cards }: { cards: PipelineCard[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
      <div className="flex gap-3">
        {OPEN_STAGES.map((stage) => {
          const stageCards = cards.filter((card) => card.stage === stage);
          const value = stageValue(stageCards);
          return (
            <section key={stage} aria-label={humanize(stage)} className="flex w-60 shrink-0 flex-col gap-2">
              <div className="flex items-baseline gap-1.5 px-1 pb-1">
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">{humanize(stage)}</h2>
                <span className="text-xs text-ink-subtle">{stageCards.length}</span>
                {value ? <span className="ml-auto text-xs text-ink-subtle">{value}</span> : null}
              </div>
              <ul className="flex flex-col gap-2">
                {stageCards.map((card) => (
                  <LeadCard key={card.id} card={card} />
                ))}
                {stageCards.length === 0 ? (
                  <li className="rounded-2xl border border-dashed border-border-strong px-3 py-4 text-center text-xs text-ink-subtle">
                    No leads
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}

        <section aria-label="Closed" className="flex w-44 shrink-0 flex-col gap-2">
          <h2 className="px-1 pb-1 text-[15px] font-semibold tracking-tight text-ink-subtle">Closed</h2>
          <ul className="overflow-hidden rounded-2xl bg-surface shadow-card">
            {CLOSED_STAGES.map((stage) => {
              const stageCards = cards.filter((card) => card.stage === stage);
              const dot = stage === "won" ? "bg-success" : stage === "lost" ? "bg-danger" : "bg-ink-subtle";
              return (
                <li key={stage} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/pipeline?view=list&stage=${stage}`}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-fill-hover"
                  >
                    <span aria-hidden className={`size-[7px] rounded-full ${dot}`} />
                    <span className="flex-1 text-[13px] font-medium text-ink">{humanize(stage)}</span>
                    <span className="text-right">
                      <span className="block text-[13px] font-medium text-ink">{stageCards.length}</span>
                      <span className="block text-xs text-ink-subtle">{stageValue(stageCards) ?? "—"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
