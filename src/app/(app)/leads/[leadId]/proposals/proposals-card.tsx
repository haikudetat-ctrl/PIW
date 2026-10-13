import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClasses, labelClasses, primaryButtonClasses } from "@/components/ui/form";
import { Icon } from "@/components/ui/icons";
import { formatDateTime, humanize } from "@/lib/format";
import { createProposal } from "./actions";

type ProposalSummary = {
  id: string;
  version: number;
  status: string;
  roof_squares: number;
  recommended_tier: string;
  sent_at: string | null;
  updated_at: string;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  declined: "danger",
  void: "neutral",
};

export function ProposalsCard({
  leadId,
  proposals,
  needsSquares,
}: {
  leadId: string;
  proposals: ProposalSummary[];
  // Without a ready Google estimate the rep may need to type the squares;
  // a matched Roofr report still wins when one exists.
  needsSquares: boolean;
}) {
  const hasDraft = proposals.some((proposal) => proposal.status === "draft");

  return (
    <Card title="Proposals" ariaLabel="Proposals">
      {proposals.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <Link
                href={`/leads/${leadId}/proposals/${proposal.id}`}
                className="flex items-center justify-between gap-3 py-2.5 hover:text-tint"
              >
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  Version {proposal.version}
                  <Badge tone={STATUS_TONE[proposal.status] ?? "neutral"}>{humanize(proposal.status)}</Badge>
                  <span className="text-[13px] text-ink-subtle">
                    {Number(proposal.roof_squares).toFixed(1)} sq · {humanize(proposal.recommended_tier)} recommended
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[13px] text-ink-subtle">
                  {proposal.sent_at ? `Sent ${formatDateTime(proposal.sent_at)}` : `Edited ${formatDateTime(proposal.updated_at)}`}
                  <Icon name="chevronRight" size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-subtle">
          No proposal yet. Start one to price the CertainTeed options from the rate card.
        </p>
      )}
      {!hasDraft ? (
        <form action={createProposal.bind(null, leadId)} className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          {needsSquares ? (
            <label className={labelClasses}>
              Roof squares (used if there&apos;s no Roofr report)
              <input name="roofSquares" type="number" step="0.1" min="0.1" className={`${inputClasses} w-40`} />
            </label>
          ) : null}
          <button type="submit" className={primaryButtonClasses}>
            <Icon name="plus" size={14} />
            New proposal
          </button>
        </form>
      ) : null}
    </Card>
  );
}
